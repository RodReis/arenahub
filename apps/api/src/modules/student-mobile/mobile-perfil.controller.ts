import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { StudentSessionGuard } from '../student-identity/student-session.guard.js';
import { MobilePerfilService } from './mobile-perfil.service.js';

const ESQUEMA_DO_PERFIL = {
  type: 'object',
  properties: {
    asOf: { type: 'string' },
    nome: { type: 'string' },
    matricula: { type: 'string' },
    nascimento: { type: 'string', format: 'date' },
    email: { type: 'string', nullable: true },
    telefone: { type: 'string', nullable: true },
    alunoDesde: { type: 'string', format: 'date-time' },
    unidade: { type: 'string' },
  },
  required: ['asOf', 'nome', 'matricula', 'nascimento', 'email', 'telefone', 'alunoDesde', 'unidade'],
};

/**
 * Perfil do aluno no app. SEM PARAMETRO DE ALUNO: o `studentId` sai da
 * sessao -- `?studentId=` de outro aluno e ignorado, nao honrado.
 */
@Public()
@UseGuards(StudentSessionGuard)
@Controller('api/v1/mobile/perfil')
export class MobilePerfilController {
  constructor(private readonly perfil: MobilePerfilService) {}

  @Get()
  @ApiOkResponse({ description: 'Perfil do aluno.', schema: ESQUEMA_DO_PERFIL })
  async obter(@Req() requisicao: Request) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    return this.perfil.montar(ctx, new Date());
  }
}
