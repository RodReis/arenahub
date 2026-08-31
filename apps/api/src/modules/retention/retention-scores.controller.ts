import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import {
  RetentionScoresQueryService,
  type ScoreParaLeitura,
} from './retention-scores-query.service.js';

/**
 * Teto de 200 por pagina.
 *
 * `M6-NFR-004` pede p95 < 1s para filas paginadas, e a fila e uma leitura de
 * operacao: ninguem liga para 500 alunos numa manha. Fora da faixa e ERRO, nao
 * truncamento -- truncar em silencio faria a tela mostrar 200 de 500 sem
 * ninguem perceber que faltavam 300.
 */
const esquemaDaConsulta = z
  .object({
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

interface FatorDto {
  position: number;
  feature: string;
  observedValue: number;
  contribution: number;
  direction: string;
  label: string;
}

interface ScoreDto {
  scoreId: string;
  studentId: string;
  value: number;
  band: string;
  completeness: number;
  calibratedProbability: number | null;
  ruleVersion: string;
  observedAt: string;
  calculatedAt: string;
  freshness: { state: string; ageInDays: number };
  notice: string;
  factors: FatorDto[];
}

const ESQUEMA_DE_RESPOSTA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scoreId: { type: 'string' },
          studentId: { type: 'string' },
          value: { type: 'integer', minimum: 0, maximum: 100 },
          band: { type: 'string', enum: ['BAIXO', 'MEDIO', 'ALTO', 'CRITICO'] },
          completeness: { type: 'number' },
          calibratedProbability: { type: 'number', nullable: true },
          ruleVersion: { type: 'string' },
          observedAt: { type: 'string', format: 'date-time' },
          calculatedAt: { type: 'string', format: 'date-time' },
          freshness: {
            type: 'object',
            properties: {
              state: { type: 'string', enum: ['ATUAL', 'DESATUALIZADO', 'EXPIRADO'] },
              ageInDays: { type: 'integer' },
            },
          },
          notice: { type: 'string' },
          factors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                position: { type: 'integer' },
                feature: { type: 'string' },
                observedValue: { type: 'number' },
                contribution: { type: 'integer' },
                direction: { type: 'string', enum: ['AUMENTA', 'REDUZ'] },
                label: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

/**
 * Leitura da fila de risco e do historico por aluno (F37, Slice 6.2).
 *
 * ---------------------------------------------------------------------------
 * O DTO NAO CARREGA O VETOR DE FEATURES
 * ---------------------------------------------------------------------------
 *
 * PRD §17: "logs nao registram vetor completo de features". A regra vale para a
 * resposta pela mesma razao -- o vetor e o retrato do aluno inteiro (frequencia,
 * pagamento, avaliacao), e quem opera a fila precisa dos ATE CINCO FATORES que
 * explicam o numero, nao do dossie. Cada fator ja traz o valor observado que o
 * fez disparar, e e isso que torna o score contestavel.
 */
@Controller('api/v1/retention')
export class RetentionScoresController {
  constructor(
    private readonly contexto: TenantContextService,
    private readonly query: RetentionScoresQueryService,
  ) {}

  @Get('scores')
  @RequirePermissions('retention.read')
  @ApiOkResponse({ schema: ESQUEMA_DE_RESPOSTA })
  async listar(@Query() consulta: unknown): Promise<{ items: ScoreDto[] }> {
    const { limite } = this.validar(consulta);
    const scores = await this.query.fila(this.contexto.require(), {
      agora: new Date(),
      limite,
    });

    return { items: scores.map(paraDto) };
  }

  @Get('students/:studentId/history')
  @RequirePermissions('retention.read')
  @ApiOkResponse({ schema: ESQUEMA_DE_RESPOSTA })
  async historico(
    @Param('studentId') studentId: string,
    @Query() consulta: unknown,
  ): Promise<{ items: ScoreDto[] }> {
    const { limite } = this.validar(consulta);
    const scores = await this.query.historico(this.contexto.require(), studentId, {
      agora: new Date(),
      limite,
    });

    return { items: scores.map(paraDto) };
  }

  private validar(consulta: unknown): { limite: number } {
    const resultado = esquemaDaConsulta.safeParse(consulta);

    if (!resultado.success) {
      throw new BadRequestException('CONSULTA_INVALIDA');
    }

    return resultado.data;
  }
}

function paraDto(score: ScoreParaLeitura): ScoreDto {
  return {
    scoreId: score.scoreId,
    studentId: score.studentId,
    value: score.valor,
    band: score.faixa,
    completeness: score.completude,
    calibratedProbability: score.probabilidadeCalibrada,
    ruleVersion: score.versaoDeRegras,
    observedAt: score.observadoEm.toISOString(),
    calculatedAt: score.calculadoEm.toISOString(),
    freshness: { state: score.validade.estado, ageInDays: score.validade.idadeEmDias },
    notice: score.aviso,
    factors: score.fatores.map((fator) => ({
      position: fator.posicao,
      feature: fator.feature,
      observedValue: fator.valorObservado,
      contribution: fator.contribuicao,
      direction: fator.direcao,
      label: fator.rotulo,
    })),
  };
}
