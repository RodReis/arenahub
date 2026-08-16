import { ConflictException, Injectable } from '@nestjs/common';
import type { AccessEvent, Prisma } from '@arenahub/database';
import { createHash } from 'node:crypto';

import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * Registro de decisoes de acesso.
 *
 * ESTA CLASSE NAO TEM `atualizar` NEM `remover`, e isso e a implementacao do
 * `M1-BR-009` -- nao um esquecimento. Fato de passagem e imutavel; corrigir e
 * `registrarCorrecao`, que ACRESCENTA uma linha ligando o errado ao certo.
 *
 * Quem precisar mudar um `AccessEvent` vai ter que escrever o `UPDATE` na
 * mao, fora daqui, e isso aparece em revisao.
 */

export interface DadosDeEvento {
  tenantId: string;
  gymUnitId: string;
  edgeNodeId: string | null;
  deviceId: string | null;
  studentId: string | null;
  identityId: string | null;
  externalUserId: string | null;
  recognitionId: string | null;
  outcome: 'ALLOW' | 'DENY';
  reason:
    | 'ACTIVE_ENTITLEMENT'
    | 'ADMIN_BLOCK'
    | 'STUDENT_BLOCKED'
    | 'STUDENT_INACTIVE'
    | 'NO_ENTITLEMENT'
    | 'WRONG_UNIT'
    | 'OUTSIDE_SCHEDULE';
  entitlementId: string | null;
  validUntil: Date | null;
  policyVersion: string;
  mode: 'ONLINE' | 'OFFLINE' | 'OVERRIDE';
  method: 'FACIAL' | 'QR' | 'CARD' | 'PIN' | 'MANUAL';
  recognizedAt: Date | null;
  occurredAt: Date;
  correlationId: string;
  idempotencyKey: string;
  detail: Prisma.InputJsonValue;
}

export interface ResultadoDoAppend {
  evento: AccessEvent;
  /** `true` quando a chave ja existia e o corpo batia -- retry legitimo. */
  jaExistia: boolean;
}

@Injectable()
export class AccessEventRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Grava a decisao, ou devolve a que ja existia com a mesma chave.
   *
   * Idempotencia com DETECCAO DE DIVERGENCIA (ADR-006). Retry do Edge com o
   * mesmo corpo devolve o mesmo evento -- e o caso comum, rede ruim. Mas a
   * mesma chave com corpo DIFERENTE e outra coisa: ou o cliente esta com bug,
   * ou alguem esta tentando sobrescrever uma decisao ja registrada. Isso vira
   * 409, nunca uma gravacao silenciosa.
   *
   * O hash cobre o que define a decisao. `correlationId` fica de fora de
   * proposito: ele muda a cada tentativa por desenho, e inclui-lo faria todo
   * retry parecer divergencia.
   */
  async append(dados: DadosDeEvento, tx?: Prisma.TransactionClient): Promise<ResultadoDoAppend> {
    const db = tx ?? this.db;
    const hash = this.hashDoCorpo(dados);

    const existente = await db.accessEvent.findFirst({
      where: {
        tenantId: dados.tenantId,
        idempotencyKey: dados.idempotencyKey,
        edgeNodeId: dados.edgeNodeId,
      },
    });

    if (existente) {
      const detalhe = existente.detail as { bodyHash?: string } | null;

      if (detalhe?.bodyHash !== hash) {
        throw new ConflictException({ code: 'ACCESS_IDEMPOTENCY_CONFLICT' });
      }

      return { evento: existente, jaExistia: true };
    }

    const evento = await db.accessEvent.create({
      data: {
        tenantId: dados.tenantId,
        gymUnitId: dados.gymUnitId,
        edgeNodeId: dados.edgeNodeId,
        deviceId: dados.deviceId,
        studentId: dados.studentId,
        identityId: dados.identityId,
        externalUserId: dados.externalUserId,
        recognitionId: dados.recognitionId,
        outcome: dados.outcome,
        reason: dados.reason,
        entitlementId: dados.entitlementId,
        validUntil: dados.validUntil,
        policyVersion: dados.policyVersion,
        mode: dados.mode,
        method: dados.method,
        recognizedAt: dados.recognizedAt,
        occurredAt: dados.occurredAt,
        correlationId: dados.correlationId,
        idempotencyKey: dados.idempotencyKey,
        detail: { ...(dados.detail as object), bodyHash: hash },
      },
    });

    return { evento, jaExistia: false };
  }

  /**
   * Desfecho fisico da passagem.
   *
   * Escreve em `AccessPassage`, NUNCA no evento. Repetir o mesmo desfecho e
   * inofensivo; relatar um desfecho DIFERENTE do ja registrado e conflito --
   * a catraca nao pode ter girado e nao girado.
   */
  async registrarPassagem(
    accessEventId: string,
    estado: 'PENDING' | 'CONFIRMED' | 'TIMED_OUT' | 'NOT_APPLICABLE',
    commandId: string | null,
    reportedAt: Date | null,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.db;

    const existente = await db.accessPassage.findUnique({ where: { accessEventId } });

    if (!existente) {
      await db.accessPassage.create({
        data: { accessEventId, state: estado, commandId, reportedAt },
      });

      return;
    }

    if (existente.state === estado) return;

    // `PENDING` e o unico estado que aceita evoluir: ele significa "comando
    // enviado, aguardando giro". Terminal que muda de valor e contradicao.
    if (existente.state !== 'PENDING') {
      throw new ConflictException({ code: 'ACCESS_PASSAGE_ALREADY_TERMINAL' });
    }

    await db.accessPassage.update({
      where: { accessEventId },
      data: { state: estado, commandId: commandId ?? existente.commandId, reportedAt },
    });
  }

  /**
   * Corrige um evento -- `M1-BR-009`.
   *
   * O original permanece intocado. Esta linha e o que diz "aquele fato estava
   * errado, este outro vale".
   */
  async registrarCorrecao(
    tenantId: string,
    originalEventId: string,
    correctingEventId: string | null,
    reason: string,
    actorId: string,
    correlationId: string,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.accessEventCorrection.create({
        data: { tenantId, originalEventId, correctingEventId, reason, actorId },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'USER',
          actorId,
          action: 'access.event.corrected',
          target: 'access_event',
          targetId: originalEventId,
          correlationId,
          metadata: { correctingEventId },
        },
      });
    });
  }

  async encontrar(tenantId: string, id: string): Promise<AccessEvent | null> {
    return this.db.accessEvent.findFirst({ where: { id, tenantId } });
  }

  /**
   * Hash do que DEFINE a decisao.
   *
   * Nao inclui `correlationId` (muda por tentativa) nem `occurredAt` (relogio
   * do servidor, recalculado a cada chamada). Incluir qualquer um dos dois
   * faria todo retry legitimo virar 409.
   */
  private hashDoCorpo(dados: DadosDeEvento): string {
    const material = JSON.stringify([
      dados.tenantId,
      dados.gymUnitId,
      dados.deviceId,
      dados.externalUserId,
      dados.recognitionId,
      dados.outcome,
      dados.reason,
      dados.entitlementId,
      dados.mode,
      dados.method,
    ]);

    return createHash('sha256').update(material).digest('hex');
  }
}
