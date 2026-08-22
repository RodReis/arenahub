import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { BodyEvolutionService, type EvolucaoCorporal, type MesDaEvolucao } from './body-evolution.service.js';
import { PERIODOS, ehPeriodo, type Periodo } from './domain/periodo.js';
import type { RegiaoCorporal } from './domain/medida.js';

/**
 * Contrato de evolucao corporal para app do aluno e totem (Task 8,
 * F-multiarquivo).
 *
 * Rota nova, formato consumido pelas telas da MVP 4 -- que NAO fazem parte
 * desta fatia (ainda bloqueada). Nada consome esta API ainda: a forma tem
 * que estar certa por conta propria.
 *
 *     GET /api/v1/students/:id/body-evolution?period=30D|90D|6M|1Y|ALL
 *
 * A leitura (cor) e resolvida AQUI, no servidor -- nunca no cliente. Se cada
 * superficie calculasse a propria, o aluno veria o braco verde no celular e
 * amarelo no totem no dia em que uma faixa do fabricante mudasse
 * (`domain/leitura-de-faixa.ts`).
 */

interface MedidaDaRegiaoDto {
  fatMassKg: number | null;
  muscleMassKg: number | null;
  fatReading: string;
  muscleReading: string;
}

interface MetricaDto {
  type: string;
  value: number;
  unit: string | null;
  reading: string;
}

interface MesDto {
  assessedAtLocal: string;
  regions: Record<RegiaoCorporal, MedidaDaRegiaoDto>;
  metrics: MetricaDto[];
}

interface AnaliseDto {
  positivePoints: string[];
  attentionPoints: string[];
  disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS';
}

interface EvolucaoCorporalDto {
  months: MesDto[];
  latestAnalysis: AnaliseDto | null;
}

@Controller('api/v1')
export class BodyEvolutionController {
  constructor(
    private readonly evolucao: BodyEvolutionService,
    private readonly contexto: TenantContextService,
  ) {}

  @Get('students/:id/body-evolution')
  @RequirePermissions('health.read')
  async evolucaoDoAluno(
    @Param('id') studentId: string,
    @Query('period') period?: string,
  ): Promise<EvolucaoCorporalDto> {
    const periodo = this.exigirPeriodo(period);

    const dados = await this.evolucao.evolucao(
      this.contexto.require(),
      studentId,
      periodo,
      new Date(),
    );

    return paraDto(dados);
  }

  /** Mesma regra da F18: periodo invalido responde 400 em vez de cair num padrao. */
  private exigirPeriodo(period: string | undefined): Periodo {
    if (period === undefined || period === '') return '90D';

    if (!ehPeriodo(period)) {
      throw new BadRequestException({
        code: 'HEALTH_INVALID_PERIOD',
        detail: `periodo invalido; use um de ${PERIODOS.join(', ')}`,
      });
    }

    return period;
  }
}

function paraDto(evolucao: EvolucaoCorporal): EvolucaoCorporalDto {
  return {
    months: evolucao.months.map(paraMesDto),
    latestAnalysis:
      evolucao.latestAnalysis === null
        ? null
        : {
            positivePoints: [...evolucao.latestAnalysis.positivePoints],
            attentionPoints: [...evolucao.latestAnalysis.attentionPoints],
            disclaimerCode: evolucao.latestAnalysis.disclaimerCode,
          },
  };
}

function paraMesDto(mes: MesDaEvolucao): MesDto {
  const regioes = {} as Record<RegiaoCorporal, MedidaDaRegiaoDto>;

  for (const [regiao, medida] of Object.entries(mes.regions) as [RegiaoCorporal, MesDto['regions'][RegiaoCorporal]][]) {
    regioes[regiao] = {
      fatMassKg: medida.fatMassKg,
      muscleMassKg: medida.muscleMassKg,
      fatReading: medida.fatReading,
      muscleReading: medida.muscleReading,
    };
  }

  return {
    assessedAtLocal: mes.assessedAtLocal,
    regions: regioes,
    metrics: mes.metrics.map((metrica) => ({
      type: metrica.type,
      value: metrica.value,
      unit: metrica.unit,
      reading: metrica.reading,
    })),
  };
}
