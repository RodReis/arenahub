import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { ResumoDeFeature } from './domain/drift-de-features.js';

export const PORTA_DE_MONITORAMENTO = Symbol('PortaDeMonitoramento');

export interface EstadoDoScoring {
  readonly ligado: boolean;
  readonly ultimoSnapshotEm: Date | null;
}

export type ResumoDePeriodo = ResumoDeFeature;

export type QualPeriodo = 'ANTERIOR' | 'ATUAL';

export interface PortaDeMonitoramento {
  estadoDoScoring(contexto: TenantContext): Promise<EstadoDoScoring>;
  resumoDoPeriodo(contexto: TenantContext, qual: QualPeriodo): Promise<ResumoDePeriodo[]>;
  definirScoring(contexto: TenantContext, ligado: boolean): Promise<void>;
}

/** O tenant referido não existe. */
export class TenantNaoEncontradoError extends Error {
  constructor(tenantId: string) {
    super(`TENANT_NAO_ENCONTRADO: ${tenantId}`);
    this.name = 'TenantNaoEncontradoError';
  }
}

/**
 * Quantos dias cada período de comparação cobre.
 *
 * Sete dias contra os sete anteriores: janela curta o bastante para pegar uma
 * fonte que caiu ontem, longa o bastante para não confundir segunda-feira com
 * domingo. Comparar dia contra dia acusaria drift toda semana pelo fim de
 * semana.
 */
const DIAS_POR_PERIODO = 7;
const MILISSEGUNDOS_POR_DIA = 86_400_000;

@Injectable()
export class RetentionMonitoringRepository implements PortaDeMonitoramento {
  constructor(private readonly prisma: PrismaService) {}

  async estadoDoScoring(contexto: TenantContext): Promise<EstadoDoScoring> {
    const [tenant, ultimo] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: contexto.tenantId },
        select: { retentionScoringEnabled: true },
      }),
      this.prisma.studentFeatureSnapshot.findFirst({
        where: { tenantId: contexto.tenantId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    if (tenant === null) {
      throw new TenantNaoEncontradoError(contexto.tenantId);
    }

    return {
      ligado: tenant.retentionScoringEnabled,
      // `createdAt`, não `observedAt`: a pergunta é "QUANDO o pipeline rodou",
      // não "que dia ele descreveu". Uma reconstrução histórica gravaria
      // `observedAt` antigo com `createdAt` de hoje, e usar `observedAt` faria
      // um pipeline saudável parecer parado há meses.
      ultimoSnapshotEm: ultimo?.createdAt ?? null,
    };
  }

  /**
   * Agrega as features de um período de sete dias.
   *
   * A média usa **só os valores observados** — ausente não é zero, e somá-lo
   * como zero puxaria a média para baixo exatamente quando a fonte cai,
   * mascarando o drift de ausência com um drift de média que não existe.
   * É `M6-BR-002` chegando até o monitoramento.
   */
  async resumoDoPeriodo(
    contexto: TenantContext,
    qual: QualPeriodo,
  ): Promise<ResumoDePeriodo[]> {
    const ultimo = await this.prisma.studentFeatureSnapshot.findFirst({
      where: { tenantId: contexto.tenantId },
      orderBy: { observedAt: 'desc' },
      select: { observedAt: true },
    });

    if (ultimo === null) {
      return [];
    }

    const fim = ultimo.observedAt.getTime();
    const janela = DIAS_POR_PERIODO * MILISSEGUNDOS_POR_DIA;
    const ate = qual === 'ATUAL' ? fim : fim - janela;
    const de = ate - janela;

    const valores = await this.prisma.studentFeatureValue.findMany({
      where: {
        tenantId: contexto.tenantId,
        snapshot: {
          tenantId: contexto.tenantId,
          observedAt: { gt: new Date(de), lte: new Date(ate) },
        },
      },
      select: { name: true, value: true },
    });

    const porNome = new Map<string, { observados: number; ausentes: number; soma: number }>();

    for (const valor of valores) {
      const atual = porNome.get(valor.name) ?? { observados: 0, ausentes: 0, soma: 0 };
      if (valor.value === null) {
        atual.ausentes += 1;
      } else {
        atual.observados += 1;
        atual.soma += Number(valor.value);
      }
      porNome.set(valor.name, atual);
    }

    return [...porNome.entries()]
      .map(([nome, agregado]) => ({
        nome,
        observados: agregado.observados,
        ausentes: agregado.ausentes,
        media: agregado.observados === 0 ? 0 : agregado.soma / agregado.observados,
      }))
      // Ordem estável: a comparação é por nome, mas a lista também vai para a
      // tela, e o Postgres não promete ordem.
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }

  async definirScoring(contexto: TenantContext, ligado: boolean): Promise<void> {
    await this.prisma.tenant.update({
      where: { id: contexto.tenantId },
      data: { retentionScoringEnabled: ligado },
    });
  }
}
