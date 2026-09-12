import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import {
  GRANULARIDADES,
  ehGranularidade,
  type Granularidade,
} from '../health/domain/frequencia.js';
import { PERIODOS, ehPeriodo, type Periodo } from '../health/domain/periodo.js';
import { StudentSessionGuard } from '../student-identity/student-session.guard.js';
import { MobileFrequenciaService } from './mobile-frequencia.service.js';

const ESQUEMA_DA_FREQUENCIA = {
  type: 'object',
  properties: {
    asOf: { type: 'string' },
    status: { type: 'string', enum: ['AVAILABLE', 'UNAVAILABLE'] },
    periodo: { type: 'string', enum: [...PERIODOS] },
    granularidade: { type: 'string', enum: [...GRANULARIDADES] },
    totalDeSessoes: { type: 'number' },
    totalDePassagens: { type: 'number' },
    baldes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rotulo: { type: 'string' },
          sessoes: { type: 'number' },
          passagens: { type: 'number' },
        },
        required: ['rotulo', 'sessoes', 'passagens'],
      },
    },
    consistencia: {
      type: 'object',
      properties: {
        semanasComSessao: { type: 'number' },
        semanasElegiveis: { type: 'number' },
        proporcao: { type: 'number', nullable: true },
      },
      required: ['semanasComSessao', 'semanasElegiveis', 'proporcao'],
    },
  },
  required: [
    'asOf',
    'status',
    'periodo',
    'granularidade',
    'totalDeSessoes',
    'totalDePassagens',
    'baldes',
    'consistencia',
  ],
};

/**
 * Frequencia do aluno -- Slice 4.2, `M4-FR-008`.
 *
 * SEM PARAMETRO DE ALUNO: o `studentId` sai da sessao, como no plano.
 *
 * Os nomes de periodo e granularidade sao os MESMOS do painel (`30D`, `90D`,
 * `SEMANAL`, ...), e as funcoes de validacao sao as mesmas do modulo de
 * health. Um vocabulario proprio do app obrigaria a traduzir nos dois
 * sentidos, e a traducao e onde `90D` de um lado vira `6M` do outro.
 */
@Public()
@UseGuards(StudentSessionGuard)
@Controller('api/v1/mobile/frequencia')
export class MobileFrequenciaController {
  constructor(private readonly frequencia: MobileFrequenciaService) {}

  @Get()
  @ApiQuery({ name: 'periodo', required: false, enum: [...PERIODOS] })
  @ApiQuery({ name: 'granularidade', required: false, enum: [...GRANULARIDADES] })
  @ApiOkResponse({ description: 'Frequência do aluno.', schema: ESQUEMA_DA_FREQUENCIA })
  async obter(
    @Req() requisicao: Request,
    @Query('periodo') periodo?: string,
    @Query('granularidade') granularidade?: string,
  ) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    return this.frequencia.montar(
      ctx,
      this.exigirPeriodo(periodo),
      this.exigirGranularidade(granularidade),
      new Date(),
    );
  }

  /**
   * AUSENTE tem padrao; INVALIDO e recusado.
   *
   * A distincao importa: quem nao mandou nada nao afirmou nada, e `30D` e a
   * primeira tela razoavel. Quem mandou `ONTEM` afirmou algo que nao existe,
   * e cair no padrao devolveria um numero correto para OUTRA pergunta -- que
   * a tela exibiria como resposta a que foi feita.
   */
  private exigirPeriodo(periodo: string | undefined): Periodo {
    if (periodo === undefined || periodo === '') return '30D';

    if (!ehPeriodo(periodo)) {
      throw new BadRequestException({
        code: 'MOBILE_INVALID_PERIOD',
        detail: `periodo invalido; use um de ${PERIODOS.join(', ')}`,
      });
    }

    return periodo;
  }

  /** Padrao SEMANAL: e a unidade em que o aluno pensa a propria rotina. */
  private exigirGranularidade(granularidade: string | undefined): Granularidade {
    if (granularidade === undefined || granularidade === '') return 'SEMANAL';

    if (!ehGranularidade(granularidade)) {
      throw new BadRequestException({
        code: 'MOBILE_INVALID_GRANULARITY',
        detail: `granularidade invalida; use uma de ${GRANULARIDADES.join(', ')}`,
      });
    }

    return granularidade;
  }
}
