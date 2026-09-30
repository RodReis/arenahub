import { Injectable, NotFoundException } from '@nestjs/common';
import { ALLOW_REASON, POLICY_VERSION } from '@arenahub/access-policy';

import type { ContextoDoEdge } from '../edge-auth/edge-auth.service.js';
import { DeviceRepository } from '../devices/device.repository.js';
import { IdentityResolver } from './identity-resolver.js';
import { AccessEventRepository } from './access-event.repository.js';
import { PrismaService } from '../../persistence/prisma.service.js';

export interface PassagemOffline {
  deviceSerial: string;
  externalUserId: string;
  recognitionId: string;
  /** Horario do EQUIPAMENTO -- e o fato que aconteceu, nao o recebimento. */
  occurredAt: Date;
  idempotencyKey: string;
  correlationId: string;
}

export interface OfflinePassageRegistrada {
  accessEventId: string;
  outcome: 'ALLOW';
  reason: typeof ALLOW_REASON.OFFLINE_DEVICE_DECISION;
}

/**
 * Registra o que a catraca JA DECIDIU sozinha, offline -- #477.
 *
 * NAO E DECISAO. O equipamento ja liberou, a pessoa ja passou; isto e
 * CONTABILIDADE do que aconteceu (regra de arquitetura no 1 continua de pe:
 * quem decidiu foi o dispositivo, fora do alcance do Access Decision Engine
 * -- o ArenaHub nao inventa entitlement, so registra o fato fisico).
 *
 * Por isso NUNCA passa por `evaluateAccess`, nunca consulta `Entitlement`,
 * e o `AllowReason` e fixo (`OFFLINE_DEVICE_DECISION`), nao calculado.
 *
 * Identidade que nao resolve AINDA registra o evento -- sem `studentId`,
 * como o caminho online (`decide-online-access.use-case.ts`). O que
 * interessa aqui e o FATO da passagem, para a frequencia nao ficar com
 * buraco; quem foi se resolve depois, olhando o `externalUserId` gravado.
 *
 * Idempotente por `(edgeNodeId, idempotencyKey)`, igual ao caminho online
 * (ADR-006): o Edge reenvia o mesmo backlog em cada retomada, e reprocessar
 * tem que ser seguro.
 */
@Injectable()
export class RecordOfflinePassageUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly dispositivos: DeviceRepository,
    private readonly identidades: IdentityResolver,
    private readonly eventos: AccessEventRepository,
  ) {}

  async executar(
    edge: ContextoDoEdge,
    entrada: PassagemOffline,
  ): Promise<OfflinePassageRegistrada> {
    const leitor = await this.dispositivos.encontrarDoEdgePorSerial(edge, entrada.deviceSerial);

    if (!leitor) throw new NotFoundException({ code: 'DEVICE_NOT_IN_SCOPE' });

    const identidade = await this.identidades.resolver(
      edge,
      { id: leitor.id },
      entrada.externalUserId,
    );

    const { evento } = await this.db.$transaction(async (tx) => {
      const resultado = await this.eventos.append(
        {
          tenantId: edge.tenantId,
          gymUnitId: edge.gymUnitId,
          edgeNodeId: edge.edgeNodeId,
          deviceId: leitor.id,
          studentId: identidade.resolvida ? identidade.studentId : null,
          identityId: identidade.resolvida ? identidade.identityId : null,
          externalUserId: entrada.externalUserId,
          recognitionId: entrada.recognitionId,
          outcome: 'ALLOW',
          reason: ALLOW_REASON.OFFLINE_DEVICE_DECISION,
          entitlementId: null,
          validUntil: null,
          policyVersion: POLICY_VERSION,
          mode: 'OFFLINE',
          method: 'FACIAL',
          recognizedAt: entrada.occurredAt,
          occurredAt: entrada.occurredAt,
          correlationId: entrada.correlationId,
          idempotencyKey: entrada.idempotencyKey,
          detail: {
            ...(identidade.resolvida ? {} : { identityResolution: identidade.motivo }),
          },
        },
        tx,
      );

      // Sem outbox: nao e AccessGranted (o motor nao decidiu nada) e a
      // pessoa ja esta dentro ha tempo -- notificar agora seria falso
      // ao-vivo. O evento existe para frequencia e auditoria, nao para
      // disparar efeito colateral.
      return resultado;
    });

    return {
      accessEventId: evento.id,
      outcome: 'ALLOW',
      reason: ALLOW_REASON.OFFLINE_DEVICE_DECISION,
    };
  }
}
