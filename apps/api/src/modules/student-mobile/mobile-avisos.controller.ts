import { Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { StudentSessionGuard } from '../student-identity/student-session.guard.js';
import { MobileAvisosService } from './mobile-avisos.service.js';

const ESQUEMA_DO_AVISO = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    tipo: { type: 'string', enum: ['BILLING', 'ASSESSMENT', 'MEMBERSHIP', 'GENERAL'] },
    titulo: { type: 'string' },
    corpo: { type: 'string' },
    rota: { type: 'string', nullable: true },
    lido: { type: 'boolean' },
    criadoEm: { type: 'string' },
  },
  required: ['id', 'tipo', 'titulo', 'corpo', 'rota', 'lido', 'criadoEm'],
};

const ESQUEMA_DA_CAIXA = {
  type: 'object',
  properties: {
    asOf: { type: 'string' },
    avisos: { type: 'array', items: ESQUEMA_DO_AVISO },
    naoLidos: { type: 'number' },
  },
  required: ['asOf', 'avisos', 'naoLidos'],
};

/**
 * Caixa de avisos do aluno -- F29, Slice 4.7.
 *
 * SEM PARAMETRO DE ALUNO em rota, query ou corpo: o `studentId` sai da
 * sessao, como em todo este canal. O id que aparece na rota de leitura e o do
 * AVISO, e a posse dele e conferida no banco.
 */
@Public()
@UseGuards(StudentSessionGuard)
@Controller('api/v1/mobile/avisos')
export class MobileAvisosController {
  constructor(private readonly avisos: MobileAvisosService) {}

  @Get()
  @ApiOkResponse({ description: 'Avisos do aluno.', schema: ESQUEMA_DA_CAIXA })
  async listar(@Req() requisicao: Request) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    return this.avisos.listar(ctx, new Date());
  }

  /**
   * `POST`, nao `PATCH`: e um ato ("li isto"), nao a edicao de um campo que o
   * cliente escolhe. O app nunca manda `readAt` -- o instante e do servidor.
   */
  @Post(':id/lido')
  @ApiOkResponse({ description: 'Aviso marcado como lido.', schema: ESQUEMA_DO_AVISO })
  async marcarComoLido(
    @Req() requisicao: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    return this.avisos.marcarComoLido(ctx, id, new Date());
  }
}
