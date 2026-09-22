import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { comContexto } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { PlatformAuditService } from './platform-audit.service.js';

const CONVITE_VALIDO_POR_HORAS = 24;
const BYTES_DE_TOKEN = 32;
/** Mesmo minimo da elevacao de suporte: nao aceita "ok" nem ".". */
const MOTIVO_MINIMO = 10;

export class TenantSemPapelOwnerError extends ErroDeDominio {
  constructor() {
    super('TENANT_SEM_OWNER', 500, 'Esta academia nao tem papel de administrador');
  }
}

/**
 * Corrigir o e-mail so vale ANTES do aceite (BR-2).
 *
 * Depois do aceite existe `User` com esse endereco, e trocar o e-mail dele e
 * operacao de conta -- muda login, sessoes e recuperacao de senha. Deixar a
 * mesma rota fazer as duas coisas esconderia essa diferenca atras de um campo.
 */
export class AdminJaAceitouError extends ErroDeDominio {
  constructor() {
    super('ADMIN_JA_ACEITOU', 409, 'O administrador ja entrou; o e-mail nao pode mais ser trocado');
  }
}

export class MotivoObrigatorioError extends ErroDeDominio {
  constructor() {
    super('MOTIVO_OBRIGATORIO', 400, 'Escreva o motivo da revogacao');
  }
}

export class ConvitePendenteInexistenteError extends ErroDeDominio {
  constructor() {
    super('CONVITE_NAO_ENCONTRADO', 404, 'Nao ha convite pendente para revogar');
  }
}

/** O que a aba "Acesso" mostra. Deriva de `Invitation` + `UserRole`. */
export type EstadoDoAdmin =
  | { estado: 'ATIVO'; email: string; desde: Date }
  | { estado: 'PENDENTE'; email: string; expiraEm: Date }
  | { estado: 'VENCIDO'; email: string; expirouEm: Date }
  | { estado: 'SEM_CONVITE'; email: null };

/**
 * O acesso do Admin de um tenant, visto e consertado pelo Super Admin -- F79.
 *
 * O convite do Admin nasce em `CriarTenantUseCase` e vale 24 horas. Ate esta
 * fatia nao havia como reenvia-lo: cliente que demorasse dois dias ficava
 * trancado fora da propria academia, e o unico conserto era escrever no banco.
 */
@Injectable()
export class AdminDoTenantUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly auditoria: PlatformAuditService,
  ) {}

  async consultar(tenantId: string): Promise<EstadoDoAdmin> {
    const papel = await this.papelDeOwner(tenantId);

    if (!papel) return { estado: 'SEM_CONVITE', email: null };

    /*
     * O VINCULO VENCE O CONVITE, e a ordem importa.
     *
     * Depois do aceite o convite fica `ACCEPTED` e nao some, entao perguntar
     * so a ele diria "aceito em tal dia" mesmo para quem teve o acesso
     * revogado depois. Quem responde "consegue entrar?" e o `UserRole` vivo.
     */
    const vinculo = await this.db.userRole.findFirst({
      where: { tenantId, roleId: papel.id },
      select: { createdAt: true, user: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
    });

    if (vinculo) {
      return { estado: 'ATIVO', email: vinculo.user.email, desde: vinculo.createdAt };
    }

    const convite = await this.convitePendente(tenantId, papel.id);

    if (!convite) return { estado: 'SEM_CONVITE', email: null };

    if (convite.expiresAt.getTime() <= Date.now()) {
      return { estado: 'VENCIDO', email: convite.email, expirouEm: convite.expiresAt };
    }

    return { estado: 'PENDENTE', email: convite.email, expiraEm: convite.expiresAt };
  }

  /**
   * Cria, reenvia ou corrige o e-mail -- os tres produzem o mesmo resultado:
   * UM convite pendente valido. Separa-los multiplicaria caminho para o mesmo
   * destino.
   *
   * `email` ausente mantem o endereco do convite atual (reenvio puro).
   */
  async convidar(
    contexto: PlatformContext,
    tenantId: string,
    email: string | undefined,
    correlationId: string,
  ): Promise<{ token: string; email: string; expiresAt: Date }> {
    const papel = await this.papelDeOwner(tenantId);

    if (!papel) throw new TenantSemPapelOwnerError();

    const jaAceitou = await this.db.userRole.findFirst({
      where: { tenantId, roleId: papel.id },
      select: { id: true },
    });

    // Reenviar para quem ja entrou nao tem efeito util, e trocar o e-mail
    // nesse ponto e operacao de conta (BR-2).
    if (jaAceitou) throw new AdminJaAceitouError();

    const pendente = await this.convitePendente(tenantId, papel.id);
    const destino = (email ?? pendente?.email ?? '').trim().toLowerCase();

    // Sem e-mail no corpo e sem convite de onde herda-lo nao ha para onde
    // enviar. Acontece no tenant cujo convite foi revogado.
    if (destino === '') throw new ConvitePendenteInexistenteError();

    const token = randomBytes(BYTES_DE_TOKEN).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + CONVITE_VALIDO_POR_HORAS * 60 * 60 * 1000);
    const trocouEmail = pendente !== null && pendente.email !== destino;

    /*
     * `comContexto` pela mesma razao da issue #302: a rota e de plataforma,
     * autenticada por `PlatformContext` e sem tenant, entao o
     * `TenantRlsInterceptor` nunca abre escopo. Sem isto, o insert em
     * `audit_logs` (RLS desde a F66) recusa com 42501.
     */
    await comContexto({ kind: 'platform' }, () =>
      this.db.$transaction(async (tx) => {
        /*
         * REVOGA O ANTERIOR NA MESMA TRANSACAO (BR-1).
         *
         * Estender o prazo do token antigo deixaria dois links vivos, e um
         * deles numa caixa de e-mail que ja pode ter vazado -- e o motivo de
         * reenviar as vezes e justamente o endereco errado.
         *
         * `status: 'PENDING'` no `where` e a exclusao mutua: se alguem
         * aceitou entre a leitura e esta escrita, `count` volta zero e o
         * convite novo nao nasce por cima de um aceite.
         */
        if (pendente) {
          const revogados = await tx.invitation.updateMany({
            where: { id: pendente.id, status: 'PENDING' },
            data: { status: 'REVOKED', revokedAt: new Date() },
          });

          if (revogados.count === 0) throw new AdminJaAceitouError();
        }

        await tx.invitation.create({
          data: {
            tenantId,
            email: destino,
            roleId: papel.id,
            // Sem `gymUnitId`, como em `CriarTenantUseCase`: amarrar o dono a
            // matriz o deixaria sem enxergar a segunda unidade quando ela
            // abrisse.
            tokenHash,
            expiresAt,
          },
        });

        await this.auditoria.registrar(
          contexto,
          {
            action: 'tenant.admin_invited',
            target: 'tenant',
            targetId: tenantId,
            tenantId,
            // Sem PII: o e-mail nao entra em auditoria, mesma regra de
            // `tenant.created`. Audita-se o ATO e se houve troca de endereco.
            metadata: { trocouEmail },
          },
          correlationId,
          tx,
        );

        // A segunda linha, dentro do tenant: quem opera a academia precisa
        // ver o que a plataforma fez na casa dele (INV-008).
        await tx.auditLog.create({
          data: {
            tenantId,
            actorType: 'SUPPORT',
            actorId: contexto.actorId,
            action: 'tenant.admin_invited',
            target: 'invitation',
            correlationId,
            metadata: { trocouEmail },
          },
        });
      }),
    );

    return { token, email: destino, expiresAt };
  }

  /**
   * `motivo` E OBRIGATORIO, e nao e enfeite de interface.
   *
   * Revogar tira o acesso de alguem e nao se desfaz: o link antigo morre e o
   * caminho de volta e convidar de novo. Pedir o motivo na tela e DESCARTA-LO
   * seria teatro -- a pergunta existe porque a resposta vai para a auditoria,
   * como no desligamento de cliente e na revogacao de biometria.
   */
  async revogar(
    contexto: PlatformContext,
    tenantId: string,
    motivo: string,
    correlationId: string,
  ): Promise<void> {
    const justificativa = motivo.trim();

    if (justificativa.length < MOTIVO_MINIMO) throw new MotivoObrigatorioError();

    const papel = await this.papelDeOwner(tenantId);

    if (!papel) throw new ConvitePendenteInexistenteError();

    const pendente = await this.convitePendente(tenantId, papel.id);

    if (!pendente) throw new ConvitePendenteInexistenteError();

    await comContexto({ kind: 'platform' }, () =>
      this.db.$transaction(async (tx) => {
        /*
         * `status: 'PENDING'` no `where`, e nao um `if` sobre o que foi lido:
         * revogar enquanto alguem aceita so pode ganhar uma vez. Derivar
         * exclusao mutua de leitura anterior ja cobrou aluno em dobro nesta
         * base.
         */
        const revogados = await tx.invitation.updateMany({
          where: { id: pendente.id, status: 'PENDING' },
          data: { status: 'REVOKED', revokedAt: new Date() },
        });

        if (revogados.count === 0) throw new ConvitePendenteInexistenteError();

        await this.auditoria.registrar(
          contexto,
          {
            action: 'tenant.admin_invite_revoked',
            target: 'tenant',
            targetId: tenantId,
            tenantId,
            metadata: { motivo: justificativa },
          },
          correlationId,
          tx,
        );

        await tx.auditLog.create({
          data: {
            tenantId,
            actorType: 'SUPPORT',
            actorId: contexto.actorId,
            action: 'tenant.admin_invite_revoked',
            target: 'invitation',
            targetId: pendente.id,
            correlationId,
            metadata: { motivo: justificativa },
          },
        });
      }),
    );
  }

  private async papelDeOwner(tenantId: string): Promise<{ id: string } | null> {
    return this.db.role.findFirst({
      where: { tenantId, name: 'OWNER' },
      select: { id: true },
    });
  }

  private async convitePendente(
    tenantId: string,
    roleId: string,
  ): Promise<{ id: string; email: string; expiresAt: Date } | null> {
    return this.db.invitation.findFirst({
      where: { tenantId, roleId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, expiresAt: true },
    });
  }
}
