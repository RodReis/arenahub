import { Injectable } from '@nestjs/common';
import type { BodyMeasurementType } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';
import type {
  MetaAtivaParaAvaliar,
  PortaDeDeteccaoDeMeta,
} from './health-goal-detection.repository.js';

/**
 * `health_goals`/`body_assessments`/`body_measurements` NAO tem politica
 * RLS (so `Student` e `AuditLog` tem) -- `this.db` direto e correto, sem
 * `comTenant`. O job e CROSS-TENANT por natureza, igual o despachante.
 */
@Injectable()
export class HealthGoalDetectionRepository implements PortaDeDeteccaoDeMeta {
  constructor(private readonly db: PrismaService) {}

  async metasAtivasSemConquista(): Promise<readonly MetaAtivaParaAvaliar[]> {
    const metas = await this.db.healthGoal.findMany({
      where: { closedAt: null, achievedAt: null },
    });

    return metas.map((meta) => ({
      id: meta.id,
      tenantId: meta.tenantId,
      studentId: meta.studentId,
      type: meta.type,
      baseline: meta.baselineValue.toNumber(),
      alvo: meta.targetValue.toNumber(),
      prazo: meta.deadline,
      achievedAt: meta.achievedAt,
    }));
  }

  async ultimoValorPublicado(
    tenantId: string,
    studentId: string,
    type: string,
  ): Promise<number | null> {
    const medida = await this.db.bodyMeasurement.findFirst({
      where: {
        tenantId,
        type: type as BodyMeasurementType,
        assessment: { studentId, status: 'PUBLISHED' },
      },
      orderBy: { assessment: { assessedAt: 'desc' } },
      select: { canonicalValue: true },
    });

    return medida ? medida.canonicalValue.toNumber() : null;
  }

  async marcarAtingidaEPublicar(tenantId: string, goalId: string, agora: Date): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      // `updateMany` com `achievedAt: null` no WHERE: dois ciclos
      // concorrentes avaliando a mesma meta so um grava e publica.
      const atualizado = await tx.healthGoal.updateMany({
        where: { id: goalId, tenantId, achievedAt: null },
        data: { achievedAt: agora },
      });

      if (atualizado.count === 0) return false;

      const meta = await tx.healthGoal.findUniqueOrThrow({
        where: { id: goalId },
        select: { studentId: true },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          eventType: 'HealthGoalReached',
          aggregateType: 'Student',
          aggregateId: meta.studentId,
          payload: { goalId },
        },
      });

      return true;
    });
  }
}
