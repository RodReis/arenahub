import { Injectable } from '@nestjs/common';
import { Prisma, type HealthMeasurement } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { SinalVitalValidado } from './domain/sinal-vital.js';

export interface DadosDoSinalVital {
  readonly measuredAt: Date;
  readonly recordedByUserId: string;
  readonly sinal: SinalVitalValidado;
  readonly source?: 'MANUAL' | 'DEVICE' | 'IMPORT' | undefined;
  readonly sourceReference?: string | undefined;
  /** Texto opaco do aparelho (achado, tags, observacoes) -- nunca interpretado (ADR-035). */
  readonly deviceReport?: Record<string, unknown> | undefined;
  readonly deviceModel?: string | undefined;
}

/**
 * Acesso a `health_measurements` -- sinal vital avulso do aluno (card #345).
 *
 * TODO METODO recebe `TenantContext` como PRIMEIRO argumento -- INV-003 e
 * regra de arquitetura no 2. Sem draft/publish/correction: e leitura
 * pontual, nunca documento editado (ver comentario do model no schema).
 */
@Injectable()
export class VitalRepository {
  constructor(private readonly db: PrismaService) {}

  async registrar(
    contexto: TenantContext,
    studentId: string,
    dados: DadosDoSinalVital,
  ): Promise<HealthMeasurement> {
    return this.db.healthMeasurement.create({
      data: {
        tenantId: contexto.tenantId,
        studentId,
        type: dados.sinal.type,
        value: new Prisma.Decimal(dados.sinal.value),
        secondaryValue:
          dados.sinal.secondaryValue === null ? null : new Prisma.Decimal(dados.sinal.secondaryValue),
        unit: dados.sinal.unit,
        measuredAt: dados.measuredAt,
        source: dados.source ?? 'MANUAL',
        sourceReference: dados.sourceReference ?? null,
        recordedByUserId: dados.recordedByUserId,
        deviceReport:
          dados.deviceReport === undefined ? Prisma.JsonNull : (dados.deviceReport as Prisma.InputJsonValue),
        deviceModel: dados.deviceModel ?? null,
      },
    });
  }

  async listarDoAluno(contexto: TenantContext, studentId: string): Promise<HealthMeasurement[]> {
    return this.db.healthMeasurement.findMany({
      where: { tenantId: contexto.tenantId, studentId },
      orderBy: [{ measuredAt: 'desc' }, { id: 'desc' }],
    });
  }

  async encontrar(contexto: TenantContext, id: string): Promise<HealthMeasurement | null> {
    return this.db.healthMeasurement.findFirst({
      where: { tenantId: contexto.tenantId, id },
    });
  }
}
