import { createHash, randomBytes } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectThrottlerStorage, minutes, type ThrottlerStorage } from '@nestjs/throttler';
import { comContexto, type Invitation } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { PasswordService } from '../auth/password.service.js';
import { ehDono, SoDonoMexeEmDonoError } from './protecao-do-dono.js';

const VALIDO_POR_HORAS = 24;
const BYTES_DE_TOKEN = 32;

/**
 * Teto de senhas erradas por e-mail ao aceitar convite para conta que ja
 * existe. A rota e publica e o token vale para qualquer e-mail que quem
 * convida escolha: sem teto, ela viraria um oraculo de senha contra a conta de
 * qualquer pessoa. Soma por E-MAIL (nao por IP) porque o atacante controla os
 * convites -- e os IPs.
 */
const JANELA_DE_SENHA_DE_CONVITE_MS = minutes(1);
const LIMITE_DE_SENHAS_ERRADAS_NO_CONVITE = 5;
const BLOQUEIO_DE_SENHA_DE_CONVITE_MS = minutes(5);

export class ConviteInvalidoError extends ErroDeDominio {
  constructor() {
    // UM erro para expirado, ja aceito, revogado e inexistente. Distinguir
    // ensinaria a quem sonda quais convites existiram.
    super('INVITATION_INVALID', 400, 'Convite invalido ou expirado');
  }
}

export class ConviteDeContaExistenteError extends ErroDeDominio {
  constructor() {
    // Dito de forma explicita porque quem chega aqui tem o token do convite:
    // o e-mail dele e o do convite, entao nao revela nada a um terceiro.
    super(
      'INVITATION_EXISTING_ACCOUNT',
      409,
      'Este e-mail ja tem conta. Informe a senha atual dela para aceitar o convite',
    );
  }
}

export class ConviteBloqueadoPorTentativasError extends ErroDeDominio {
  constructor() {
    super('INVITATION_LOCKED', 429, 'Muitas tentativas. Aguarde alguns minutos');
  }
}

@Injectable()
export class InvitationService {
  constructor(
    private readonly db: PrismaService,
    private readonly senhas: PasswordService,
    @InjectThrottlerStorage() private readonly forcaBruta: ThrottlerStorage,
  ) {}

  /**
   * Cria o convite e devolve o token EM CLARO uma unica vez.
   *
   * O banco guarda so o hash -- mesma regra do refresh token. Quem convidou
   * ve o link agora e entrega por fora; depois disso, nem o suporte
   * consegue recupera-lo. Convite recuperavel a qualquer momento seria uma
   * porta permanente para dentro do tenant.
   */
  async convidar(
    contexto: TenantContext,
    dados: { email: string; roleId: string; gymUnitId?: string | undefined },
    correlationId: string,
  ): Promise<{ convite: Invitation; token: string }> {
    const papel = await this.db.role.findFirst({
      where: { id: dados.roleId, tenantId: contexto.tenantId },
    });

    // Papel de outro tenant e tratado como inexistente -- 404 nao confirma
    // que o id acertou.
    if (!papel) throw new NotFoundException({ code: 'ROLE_NOT_FOUND' });

    // #523: o gerente convida a equipe, mas so o dono convida outro dono.
    if (papel.name === 'OWNER' && !(await ehDono(this.db, contexto.tenantId, contexto.actorId))) {
      throw new SoDonoMexeEmDonoError();
    }

    const token = randomBytes(BYTES_DE_TOKEN).toString('base64url');

    const convite = await this.db.$transaction(async (tx) => {
      const criado = await tx.invitation.create({
        data: {
          tenantId: contexto.tenantId,
          email: dados.email.trim().toLowerCase(),
          roleId: dados.roleId,
          ...(dados.gymUnitId ? { gymUnitId: dados.gymUnitId } : {}),
          tokenHash: this.hashDe(token),
          expiresAt: new Date(Date.now() + VALIDO_POR_HORAS * 60 * 60 * 1000),
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'invitation.created',
          target: 'invitation',
          targetId: criado.id,
          correlationId,
          // E-mail NAO entra no metadado: PII em log e proibido
          // (`CLAUDE.md`, Convencoes). O vinculo ja existe pelo targetId.
          metadata: { roleId: dados.roleId },
        },
      });

      return criado;
    });

    return { convite, token };
  }

  /**
   * Aceita o convite: cria usuario, vinculo e papel numa transacao so.
   *
   * Parcial seria pior que nada -- usuario sem papel nao entra, e papel sem
   * vinculo e permissao orfa num tenant.
   *
   * `User` e GLOBAL (e-mail unico). Se o e-mail ja tem conta, a senha enviada
   * precisa ser a DESSA conta: aceitar qualquer senha e descarta-la em silencio
   * deixava quem convidou primeiro (e escolheu a senha) como dono da conta, e a
   * pessoa real, convidada depois por outra academia, entrava com a senha dele.
   */
  async aceitar(
    token: string,
    senha: string,
    correlationId: string,
  ): Promise<{ userId: string; tenantId: string }> {
    const convite = await this.db.invitation.findUnique({
      where: { tokenHash: this.hashDe(token) },
    });

    if (!convite || convite.status !== 'PENDING') throw new ConviteInvalidoError();
    if (convite.expiresAt.getTime() <= Date.now()) throw new ConviteInvalidoError();

    const existente = await this.db.user.findUnique({
      where: { email: convite.email },
      select: { passwordHash: true },
    });

    if (existente) await this.exigirSenhaDaContaExistente(convite.email, senha, existente.passwordHash);

    const passwordHash = await this.senhas.gerarHash(senha);

    /*
     * Rota `@Public()`: quem aceita ainda nao e usuario autenticado, entao
     * nao ha `TenantContext` e o `TenantRlsInterceptor` nunca abre escopo
     * aqui -- mesma classe de bug da issue #302 (Super Admin sem tenant),
     * so que aqui o `tenantId` certo e conhecido, do proprio convite. Sem
     * `comContexto`, o insert em `audit_logs` (RLS desde a F66) recusa com
     * 42501.
     */
    return comContexto({ kind: 'tenant', tenantId: convite.tenantId }, () =>
      this.db.$transaction(async (tx) => {
        // `upsert`: a mesma pessoa pode ja ter conta por outra academia --
        // identidade e global, o vinculo e que e por tenant.
        const usuario = await tx.user.upsert({
          where: { email: convite.email },
          create: { email: convite.email, passwordHash },
          update: {},
        });

        await tx.tenantMembership.upsert({
          where: { tenantId_userId: { tenantId: convite.tenantId, userId: usuario.id } },
          create: { tenantId: convite.tenantId, userId: usuario.id },
          update: { status: 'ACTIVE' },
        });

        await tx.userRole.create({
          data: {
            tenantId: convite.tenantId,
            userId: usuario.id,
            roleId: convite.roleId,
            ...(convite.gymUnitId ? { gymUnitId: convite.gymUnitId } : {}),
          },
        });

        // Marca aceito NA MESMA transacao: fora dela, duas aceitacoes
        // simultaneas criariam dois papeis com um convite de uso unico.
        await tx.invitation.update({
          where: { id: convite.id, status: 'PENDING' },
          data: { status: 'ACCEPTED', acceptedAt: new Date() },
        });

        await tx.auditLog.create({
          data: {
            tenantId: convite.tenantId,
            actorType: 'USER',
            actorId: usuario.id,
            action: 'invitation.accepted',
            target: 'invitation',
            targetId: convite.id,
            correlationId,
          },
        });

        return { userId: usuario.id, tenantId: convite.tenantId };
      }),
    );
  }

  /** Soma TODA tentativa, como o MFA: contador que so soma em erro nunca travaria o acerto. */
  private async exigirSenhaDaContaExistente(
    email: string,
    senha: string,
    hashDaConta: string,
  ): Promise<void> {
    const registro = await this.forcaBruta.increment(
      `convite-senha:${email}`,
      JANELA_DE_SENHA_DE_CONVITE_MS,
      LIMITE_DE_SENHAS_ERRADAS_NO_CONVITE,
      BLOQUEIO_DE_SENHA_DE_CONVITE_MS,
      'invitation-password-bruteforce',
    );

    if (registro.isBlocked) throw new ConviteBloqueadoPorTentativasError();

    if (!(await this.senhas.conferir(senha, hashDaConta))) throw new ConviteDeContaExistenteError();
  }

  private hashDe(token: string): string {
    // SHA-256 sem sal, como no refresh: a entrada tem 256 bits de
    // aleatoriedade real, entao nao ha dicionario a montar.
    return createHash('sha256').update(token).digest('hex');
  }
}
