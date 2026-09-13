import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { PERIODOS, type Periodo } from '../health/domain/periodo.js';
import { StudentSessionGuard } from '../student-identity/student-session.guard.js';
import { MobileAvaliacoesService } from './mobile-avaliacoes.service.js';

const ESQUEMA_DO_HISTORICO = {
  type: 'object',
  properties: {
    asOf: { type: 'string' },
    periodo: { type: 'string', enum: [...PERIODOS] },
    series: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tipo: { type: 'string' },
          unidade: { type: 'string', nullable: true },
          pontos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                avaliacaoId: { type: 'string' },
                medidaEm: { type: 'string' },
                valor: { type: 'number' },
              },
              required: ['avaliacaoId', 'medidaEm', 'valor'],
            },
          },
          meta: {
            type: 'object',
            nullable: true,
            properties: { alvo: { type: 'number' }, prazo: { type: 'string' } },
            required: ['alvo', 'prazo'],
          },
        },
        required: ['tipo', 'unidade', 'pontos', 'meta'],
      },
    },
    analise: {
      type: 'object',
      nullable: true,
      properties: {
        geradaEm: { type: 'string' },
        analise: {
          type: 'object',
          properties: { disclaimerCode: { type: 'string', enum: ['NOT_MEDICAL_DIAGNOSIS'] } },
          required: ['disclaimerCode'],
        },
      },
      required: ['geradaEm', 'analise'],
    },
  },
  required: ['asOf', 'periodo', 'series', 'analise'],
};

/** Periodo padrao: o suficiente para o grafico ter forma sem virar historia. */
const PERIODO_PADRAO: Periodo = '90D';

/**
 * Historico corporal e analise assistiva -- Slice 4.4, `M4-FR-012`.
 *
 * SEM PARAMETRO DE ALUNO, mesma razao do `MobilePlanoController`: o
 * `studentId` sai da sessao. Aqui a consequencia e mais grave que em plano --
 * id na rota deixaria qualquer sessao valida ler o historico de saude de
 * qualquer aluno do tenant trocando um UUID.
 */
@Public()
@UseGuards(StudentSessionGuard)
@Controller('api/v1/mobile/avaliacoes')
export class MobileAvaliacoesController {
  constructor(private readonly avaliacoes: MobileAvaliacoesService) {}

  @Get()
  @ApiOkResponse({ description: 'Historico corporal do aluno.', schema: ESQUEMA_DO_HISTORICO })
  async listar(@Req() requisicao: Request, @Query('periodo') periodo?: string) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    // Periodo desconhecido cai no padrao em vez de 400: o parametro e um
    // filtro de visualizacao, e derrubar a tela inteira por causa dele
    // deixaria o aluno sem historico nenhum por um erro de digitacao na URL.
    const escolhido = PERIODOS.find((p) => p === periodo) ?? PERIODO_PADRAO;

    return this.avaliacoes.montar(ctx, escolhido, new Date());
  }
}
