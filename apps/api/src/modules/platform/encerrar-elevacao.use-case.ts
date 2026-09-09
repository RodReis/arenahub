import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { TokenService } from '../auth/token.service.js';
import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PlatformAuditService } from './platform-audit.service.js';

const ENCERRADA_A_PEDIDO = 'ENDED_BY_ADMIN';

/**
 * Fecha a elevacao viva da sessao e devolve o Super Admin para fora do tenant.
 *
 * Escreve `endedAt` em vez de apagar: o rastro de que houve suporte nao some.
 * O token novo sai SEM tenant, entao a proxima requisicao volta a ser sessao
 * de plataforma.
 */
@Injectable()
export class EncerrarElevacaoUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly tokens: TokenService,
    private readonly auditoria: PlatformAuditService,
  ) {}

  async executar(
    contexto: PlatformContext,
    correlationId: string,
  ): Promise<{ accessToken: string }> {
    const elevacao = await this.db.supportElevation.findFirst({
      where: { sessionId: contexto.sessionId, endedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!elevacao) throw new ErroDeDominio('NOT_FOUND', 404, 'Nenhuma elevacao viva nesta sessao');

    await this.db.$transaction(async (tx) => {
      await tx.supportElevation.update({
        where: { id: elevacao.id },
        data: { endedAt: new Date(), endedReason: ENCERRADA_A_PEDIDO },
      });

      await this.auditoria.registrar(
        contexto,
        {
          action: 'support.ended',
          target: 'tenant',
          targetId: elevacao.tenantId,
          tenantId: elevacao.tenantId,
          metadata: { motivoDeSaida: ENCERRADA_A_PEDIDO },
        },
        correlationId,
        tx,
      );

      // A segunda linha, no tenant alvo: a saida do suporte e tao visivel
      // para o dono da academia quanto a entrada (INV-008).
      await tx.auditLog.create({
        data: {
          tenantId: elevacao.tenantId,
          actorType: 'SUPPORT',
          actorId: contexto.actorId,
          action: 'support.ended',
          target: 'tenant',
          targetId: elevacao.tenantId,
          correlationId,
          metadata: { motivoDeSaida: ENCERRADA_A_PEDIDO },
        },
      });
    });

    const accessToken = this.tokens.emitirAcesso({
      sub: contexto.actorId,
      tenantId: null,
      sessionId: contexto.sessionId,
      permissions: [],
      mfa: true,
    });

    return { accessToken };
  }
}
