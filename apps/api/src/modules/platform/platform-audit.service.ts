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

  /**
   * `contexto` e `null` quando o ato e de JOB, sem usuario de painel por
   * tras. Nulo aqui e DADO legitimo, nao ausencia de dado:
   * `PlatformAuditLog.actorUserId` e `String?` no schema exatamente por isso.
   */
  async registrar(
    contexto: PlatformContext | null,
    ato: AtoDePlataforma,
    correlationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const cliente = tx ?? this.db;

    await cliente.platformAuditLog.create({
      data: {
        actorUserId: contexto?.actorId ?? null,
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
