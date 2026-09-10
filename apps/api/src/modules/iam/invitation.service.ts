import { createHash, randomBytes } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import { comContexto, type Invitation } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { PasswordService } from '../auth/password.service.js';

const VALIDO_POR_HORAS = 24;
const BYTES_DE_TOKEN = 32;

export class ConviteInvalidoError extends ErroDeDominio {
  constructor() {
    // UM erro para expirado, ja aceito, revogado e inexistente. Distinguir
    // ensinaria a quem sonda quais convites existiram.
    super('INVITATION_INVALID', 400, 'Convite invalido ou expirado');
  }
}

@Injectable()
export class InvitationService {
  constructor(
    private readonly db: PrismaService,
    private readonly senhas: PasswordService,
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

  private hashDe(token: string): string {
    // SHA-256 sem sal, como no refresh: a entrada tem 256 bits de
    // aleatoriedade real, entao nao ha dicionario a montar.
    return createHash('sha256').update(token).digest('hex');
  }
}
