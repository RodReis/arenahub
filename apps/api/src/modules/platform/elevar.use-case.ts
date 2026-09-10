import { Injectable } from '@nestjs/common';
import { comContexto } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { TokenService } from '../auth/token.service.js';
import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PlatformAuditService } from './platform-audit.service.js';

export class JustificativaObrigatoriaError extends ErroDeDominio {
  constructor() {
    super('JUSTIFICATIVA_OBRIGATORIA', 400, 'Escreva a justificativa da entrada de suporte');
  }
}

export class ElevacaoJaAbertaError extends ErroDeDominio {
  constructor() {
    super('ELEVACAO_JA_ABERTA', 409, 'Encerre o suporte em andamento antes de entrar em outro');
  }
}

const JUSTIFICATIVA_MINIMA = 10;
const ELEVACAO_VALIDA_POR_MINUTOS = 30;

/**
 * Abre sessao de suporte num tenant. INV-005: nunca bypass silencioso --
 * justificativa, prazo e auditoria dos DOIS lados.
 *
 * O token novo carrega o tenant alvo, mas quem autoriza de verdade e o
 * `SupportElevation` VIVO lido pelo `AuthGuard` a cada requisicao. Assim,
 * encerrar a elevacao vale na hora, e nao ao fim dos dez minutos do token.
 */
@Injectable()
export class ElevarUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly tokens: TokenService,
    private readonly auditoria: PlatformAuditService,
  ) {}

  async executar(
    contexto: PlatformContext,
    tenantId: string,
    reason: string,
    correlationId: string,
  ): Promise<{ accessToken: string; expiresAt: Date; elevacaoId: string }> {
    const justificativa = reason.trim();

    if (justificativa.length < JUSTIFICATIVA_MINIMA) throw new JustificativaObrigatoriaError();

    /*
     * Uma elevacao viva por sessao.
     *
     * `EncerrarElevacaoUseCase` fecha a MAIS RECENTE. Empilhar A e B faria
     * uma saida deixar A aberta e orfa: quem operou acredita ter saido, e a
     * linha segue autorizando ate expirar -- o bypass silencioso que INV-005
     * proibe. Barrar na entrada e mais barato que ensinar a saida a fechar
     * varias, porque duas elevacoes vivas nunca sao estado desejado.
     */
    const jaAberta = await this.db.supportElevation.findFirst({
      where: { sessionId: contexto.sessionId, endedAt: null, expiresAt: { gt: new Date() } },
    });

    if (jaAberta) throw new ElevacaoJaAbertaError();

    const tenant = await this.db.tenant.findUnique({ where: { id: tenantId } });

    if (!tenant) throw new ErroDeDominio('NOT_FOUND', 404, 'Tenant nao encontrado');

    const expiresAt = new Date(Date.now() + ELEVACAO_VALIDA_POR_MINUTOS * 60 * 1000);

    /*
     * Issue #302: esta transacao escreve em `audit_logs` (politica RLS desde
     * a F66, ADR-054) ANTES de a `SupportElevation` existir para o
     * `AuthGuard` ler -- a rota e autenticada por `PlatformContext`, sem
     * tenant, entao o `TenantRlsInterceptor` nunca abre escopo aqui. Sem o
     * `comContexto` explicito, `app.actor` fica NULL na transacao e a
     * politica recusa a linha com 42501. `platform` e o caminho que o
     * ADR-052 SS3 reserva para a sessao elevada de Super Admin.
     */
    const elevacao = await comContexto({ kind: 'platform' }, () =>
      this.db.$transaction(async (tx) => {
        const criada = await tx.supportElevation.create({
          data: {
            sessionId: contexto.sessionId,
            platformAdminUserId: contexto.actorId,
            tenantId,
            reason: justificativa,
            expiresAt,
          },
        });

        await this.auditoria.registrar(
          contexto,
          {
            action: 'support.elevated',
            target: 'tenant',
            targetId: tenantId,
            tenantId,
            metadata: { motivo: justificativa, expiraEm: expiresAt.toISOString() },
          },
          correlationId,
          tx,
        );

        // A SEGUNDA linha, no tenant alvo: quem opera a academia precisa ver
        // que houve suporte dentro da casa dele (INV-008).
        await tx.auditLog.create({
          data: {
            tenantId,
            actorType: 'SUPPORT',
            actorId: contexto.actorId,
            action: 'support.elevated',
            target: 'tenant',
            targetId: tenantId,
            correlationId,
            metadata: { motivo: justificativa, expiraEm: expiresAt.toISOString() },
          },
        });

        return criada;
      }),
    );

    const accessToken = this.tokens.emitirAcesso({
      sub: contexto.actorId,
      tenantId,
      sessionId: contexto.sessionId,
      // Vazio de proposito: o `AuthGuard` le as permissoes do BANCO, nunca do
      // token, e para o ator de plataforma elas saem da elevacao.
      permissions: [],
      mfa: true,
    });

    return { accessToken, expiresAt, elevacaoId: elevacao.id };
  }
}
