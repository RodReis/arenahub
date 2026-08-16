import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { POLICY_VERSION } from '@arenahub/access-policy';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { AccessEventRepository } from './access-event.repository.js';

/**
 * Liberacao manual pela recepcao -- `M1-FR-023`, `M1-BR-007`, `M1-AC-008`.
 *
 * `M1-BR-007` DIZ O QUE ESTE ARQUIVO NAO PODE FAZER: override nunca altera
 * assinatura ou entitlement em silencio. A garantia comeca no schema --
 * `ManualAccessOverride` nao tem coluna que aponte para nenhum dos dois --
 * e continua aqui: nao ha `subscription` nem `entitlement` em nenhuma query.
 *
 * O override e um FATO PARALELO: "a recepcao abriu a catraca para esta
 * pessoa, neste dispositivo, por este motivo". Ele nao concede direito, nao
 * prorroga nada e nao muda o que a proxima decisao vai devolver. Se a pessoa
 * voltar em cinco minutos, o motor nega de novo -- e e assim que tem de ser.
 */

export interface PedidoDeOverride {
  gymUnitId: string;
  /** Um dos dois. Aluno conhecido OU visitante descrito. */
  studentId?: string | undefined;
  visitorDescription?: string | undefined;
  deviceId: string;
  reason: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface OverrideRegistrado {
  overrideId: string;
  accessEventId: string;
  /** `true` quando a chave ja tinha sido usada -- clique duplo, retry. */
  replayed: boolean;
}

@Injectable()
export class ManualOverrideUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly eventos: AccessEventRepository,
  ) {}

  async executar(
    contexto: TenantContext,
    pedido: PedidoDeOverride,
  ): Promise<OverrideRegistrado> {
    // Aluno OU visitante, nunca os dois nem nenhum. Sem esta checagem, um
    // override sem sujeito viraria evento que nao diz quem passou.
    const temAluno = pedido.studentId !== undefined && pedido.studentId !== '';
    const temVisitante =
      pedido.visitorDescription !== undefined && pedido.visitorDescription !== '';

    if (temAluno === temVisitante) {
      throw new BadRequestException({ code: 'ACCESS_OVERRIDE_SUBJECT_REQUIRED' });
    }

    // Escopo de unidade: um gerente restrito a unidade A nao abre a catraca
    // da unidade B nem sabendo o UUID do dispositivo.
    if (
      contexto.allowedUnitIds !== 'ALL' &&
      !contexto.allowedUnitIds.has(pedido.gymUnitId)
    ) {
      throw new NotFoundException({ code: 'GYM_UNIT_NOT_FOUND' });
    }

    const dispositivo = await this.db.device.findFirst({
      where: {
        id: pedido.deviceId,
        tenantId: contexto.tenantId,
        gymUnitId: pedido.gymUnitId,
      },
      select: { id: true, edgeNodeId: true },
    });

    if (!dispositivo) throw new NotFoundException({ code: 'DEVICE_NOT_FOUND' });

    if (temAluno) {
      const aluno = await this.db.student.findFirst({
        where: { id: pedido.studentId ?? '', tenantId: contexto.tenantId },
        select: { id: true },
      });

      if (!aluno) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
    }

    const agora = new Date();

    return this.db.$transaction(async (tx) => {
      const { evento, jaExistia } = await this.eventos.append(
        {
          tenantId: contexto.tenantId,
          gymUnitId: pedido.gymUnitId,
          // NULO de proposito: override nasce na nuvem, nao no Edge. E o que
          // faz o indice parcial de idempotencia valer para ele.
          edgeNodeId: null,
          deviceId: dispositivo.id,
          studentId: temAluno ? (pedido.studentId ?? null) : null,
          identityId: null,
          externalUserId: null,
          recognitionId: null,
          // Override e ALLOW por definicao -- e a recepcao decidindo abrir.
          //
          // `MANUAL_OVERRIDE`, nunca `ACTIVE_ENTITLEMENT` (ADR-024, emenda de
          // 16/08/2026): a recepcao abre a catraca JUSTAMENTE para quem o
          // motor negou, entao afirmar direito ativo seria gravar mentira num
          // fato imutavel. O evento diz a verdade sozinho, sem depender de
          // quem le lembrar de cruzar com `mode`.
          outcome: 'ALLOW',
          reason: 'MANUAL_OVERRIDE',
          entitlementId: null,
          validUntil: null,
          policyVersion: POLICY_VERSION,
          mode: 'OVERRIDE',
          method: 'MANUAL',
          recognizedAt: null,
          occurredAt: agora,
          correlationId: pedido.correlationId,
          idempotencyKey: pedido.idempotencyKey,
          detail: {
            overrideReason: pedido.reason,
            actorId: contexto.actorId,
            ...(temVisitante ? { visitor: true } : {}),
          },
        },
        tx,
      );

      if (jaExistia) {
        const existente = await tx.manualAccessOverride.findUnique({
          where: { accessEventId: evento.id },
        });

        return {
          overrideId: existente?.id ?? '',
          accessEventId: evento.id,
          replayed: true,
        };
      }

      const override = await tx.manualAccessOverride.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: pedido.gymUnitId,
          studentId: temAluno ? (pedido.studentId ?? null) : null,
          // Minimizado por LGPD: nome e motivo bastam para auditar. Documento
          // de visitante nao entra -- guardar dado de quem nem e cliente
          // ampliaria o tratamento sem base legal que o justifique.
          visitorDescription: temVisitante ? (pedido.visitorDescription ?? null) : null,
          deviceId: dispositivo.id,
          reason: pedido.reason,
          actorId: contexto.actorId,
          accessEventId: evento.id,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'access.override.created',
          target: 'access_event',
          targetId: evento.id,
          correlationId: pedido.correlationId,
          metadata: {
            gymUnitId: pedido.gymUnitId,
            deviceId: dispositivo.id,
            subject: temAluno ? 'STUDENT' : 'VISITOR',
          },
        },
      });

      // Comando DURAVEL para o Edge, na MESMA transacao. Notificar por
      // WebSocket e otimizacao; a fonte da verdade e esta linha. Socket caido
      // nao pode significar catraca que nao abre.
      if (dispositivo.edgeNodeId) {
        const ultimo = await tx.deviceCommand.findFirst({
          where: { edgeNodeId: dispositivo.edgeNodeId },
          orderBy: { sequence: 'desc' },
          select: { sequence: true },
        });

        await tx.deviceCommand.create({
          data: {
            tenantId: contexto.tenantId,
            edgeNodeId: dispositivo.edgeNodeId,
            sequence: (ultimo?.sequence ?? 0n) + 1n,
            type: 'ACCESS_OVERRIDE_GRANT',
            payload: {
              accessEventId: evento.id,
              deviceId: dispositivo.id,
            },
            // O Edge deduplica o giro fisico pelo `accessEventId`: um evento,
            // um comando, uma liberacao.
            idempotencyKey: `override:${evento.id}`,
            correlationId: pedido.correlationId,
          },
        });
      }

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'AccessGranted',
          aggregateType: 'AccessEvent',
          aggregateId: evento.id,
          payload: {
            accessEventId: evento.id,
            gymUnitId: pedido.gymUnitId,
            studentId: temAluno ? pedido.studentId : null,
            outcome: 'ALLOW',
            reason: 'MANUAL_OVERRIDE',
            mode: 'OVERRIDE',
            occurredAt: agora.toISOString(),
            correlationId: pedido.correlationId,
          },
          occurredAt: agora,
        },
      });

      return { overrideId: override.id, accessEventId: evento.id, replayed: false };
    });
  }
}
