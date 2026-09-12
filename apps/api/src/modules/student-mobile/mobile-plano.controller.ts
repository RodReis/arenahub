import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { StudentSessionGuard } from '../student-identity/student-session.guard.js';
import { MobilePlanoService } from './mobile-plano.service.js';

const ESQUEMA_DO_PLANO = {
  type: 'object',
  properties: {
    asOf: { type: 'string' },
    status: { type: 'string', enum: ['AVAILABLE', 'UNAVAILABLE'] },
    plano: {
      type: 'object',
      nullable: true,
      properties: {
        situacao: {
          type: 'string',
          enum: ['SCHEDULED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED'],
        },
        inicioEm: { type: 'string' },
        fimEm: { type: 'string' },
        nome: { type: 'string', nullable: true },
      },
      required: ['situacao', 'inicioEm', 'fimEm', 'nome'],
    },
  },
  required: ['asOf', 'status', 'plano'],
};

/**
 * Status e validade do plano -- Slice 4.2, `M4-FR-006`.
 *
 * SEM PARAMETRO DE ALUNO, e a ausencia e o desenho: o `studentId` sai da
 * sessao. Com id na rota ou na query, quem tem uma sessao valida leria o
 * plano de qualquer aluno do tenant trocando um UUID -- e o teste de
 * integracao passa um `?studentId=` de outro aluno justamente para provar
 * que ele e ignorado.
 */
@Public()
@UseGuards(StudentSessionGuard)
@Controller('api/v1/mobile/plano')
export class MobilePlanoController {
  constructor(private readonly plano: MobilePlanoService) {}

  @Get()
  @ApiOkResponse({ description: 'Plano do aluno.', schema: ESQUEMA_DO_PLANO })
  async obter(@Req() requisicao: Request) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    return this.plano.montar(ctx, new Date());
  }
}
