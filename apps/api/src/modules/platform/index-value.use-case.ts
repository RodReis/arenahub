import { Injectable } from '@nestjs/common';
import type { IndexValue } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { PlatformAuditService } from './platform-audit.service.js';

export class CompetenciaInvalidaError extends ErroDeDominio {
  constructor() {
    super('INDEX_REFERENCE_MONTH_INVALID', 422, 'Informe a competência no formato AAAA-MM');
  }
}

/**
 * `2026-03` -> `2026-03-01T00:00:00Z`.
 *
 * A competencia entra como MES, e nao como data: aceitar `2026-03-15` deixaria
 * duas linhas para marco, e a chave unica `(code, reference_month)` nao as
 * veria como a mesma competencia. O banco tambem recusa (CHECK
 * `index_values_competencia_e_primeiro_dia`).
 */
export function competenciaParaData(competencia: string): Date {
  const casou = /^(\d{4})-(\d{2})$/.exec(competencia);

  if (!casou) throw new CompetenciaInvalidaError();

  const mes = Number(casou[2]);

  if (mes < 1 || mes > 12) throw new CompetenciaInvalidaError();

  return new Date(Date.UTC(Number(casou[1]), mes - 1, 1));
}

/**
 * Historico manual do indice de correcao -- F63, ADR-052 §7.
 *
 * ENTRADA MANUAL e deliberada: a API do Banco Central no caminho de
 * faturamento e indisponibilidade dela virando fatura errada. Automatizar e
 * ADR futuro.
 */
@Injectable()
export class IndexValueUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly auditoria: PlatformAuditService,
  ) {}

  async listar(code: string): Promise<IndexValue[]> {
    return this.db.indexValue.findMany({
      where: { code },
      orderBy: { referenceMonth: 'desc' },
    });
  }

  /**
   * Grava ou corrige o valor de uma competencia.
   *
   * `upsert`, e nao `create`: reimportar a mesma competencia com o valor
   * revisado (o IBGE revisa) tem de reencontrar a linha, e nao somar uma
   * segunda variacao sobre o mesmo mes.
   */
  async registrar(
    contexto: PlatformContext,
    entrada: { code: string; competencia: string; variationBasisPoints: number },
    correlationId: string,
  ): Promise<IndexValue> {
    const referenceMonth = competenciaParaData(entrada.competencia);

    const valor = await this.db.indexValue.upsert({
      where: { code_referenceMonth: { code: entrada.code, referenceMonth } },
      create: {
        code: entrada.code,
        referenceMonth,
        variationBasisPoints: entrada.variationBasisPoints,
      },
      update: { variationBasisPoints: entrada.variationBasisPoints },
    });

    await this.auditoria.registrar(
      contexto,
      {
        action: 'index_value.registered',
        target: 'index_value',
        targetId: valor.id,
        metadata: {
          code: entrada.code,
          competencia: entrada.competencia,
          variationBasisPoints: entrada.variationBasisPoints,
        },
      },
      correlationId,
    );

    return valor;
  }
}
