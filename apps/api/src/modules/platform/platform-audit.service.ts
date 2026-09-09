import { Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

export interface AtoDePlataforma {
  action: string;
  target: string;
  targetId?: string;
  tenantId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Escrita do `PlatformAuditLog`.
 *
 * Aceita `tx` para entrar na MESMA transacao da mudanca de estado (regra de
 * arquitetura no 5). Sem ele, auditoria de ato que falhou depois ficaria
 * gravada como se tivesse acontecido.
 */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly db: PrismaService) {}

  async registrar(
    contexto: PlatformContext,
    ato: AtoDePlataforma,
    correlationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const cliente = tx ?? this.db;

    await cliente.platformAuditLog.create({
      data: {
        actorUserId: contexto.actorId,
        action: ato.action,
        target: ato.target,
        ...(ato.targetId === undefined ? {} : { targetId: ato.targetId }),
        ...(ato.tenantId === undefined ? {} : { tenantId: ato.tenantId }),
        correlationId,
        ...(ato.metadata === undefined ? {} : { metadata: ato.metadata }),
      },
    });
  }
}
