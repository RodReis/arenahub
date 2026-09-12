import { Controller, Delete, Get, HttpCode, Param, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { StudentIdentityService } from './student-identity.service.js';
import { StudentSessionGuard } from './student-session.guard.js';

/** Confirmacao sem dado -- ver o mesmo esquema em `student-auth.controller.ts`. */
const ESQUEMA_OK = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
};

const ESQUEMA_DA_LISTA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      deviceLabel: { type: 'string', nullable: true },
      criadaEm: { type: 'string' },
      atual: { type: 'boolean' },
    },
    required: ['id', 'criadaEm', 'atual'],
  },
};

/**
 * "Onde estou conectado" -- `M4-FR-004`.
 *
 * `@Public()` tira do guard GLOBAL do painel (que le cookie e barraria tudo
 * antes de comecar) e o `StudentSessionGuard` assume. Publica aqui significa
 * "fora da porta do painel", nunca "sem autenticacao".
 */
@Public()
@UseGuards(StudentSessionGuard)
@Controller('api/v1/mobile/sessions')
export class StudentSessionsController {
  constructor(private readonly identidade: StudentIdentityService) {}

  @Get()
  @ApiOkResponse({ description: 'Sessoes ativas do aluno.', schema: ESQUEMA_DA_LISTA })
  async listar(@Req() requisicao: Request) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    return this.identidade.listarSessoes(ctx, new Date());
  }

  /**
   * Revoga UMA sessao do proprio aluno.
   *
   * A autorizacao por objeto mora no `where` do repositorio, nao aqui: um id
   * de outro aluno nao encontra linha e vira 404 -- mesmo erro de "nao
   * existe", para a rota nao virar oraculo de ids alheios.
   */
  @Delete(':id')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Sessao revogada.', schema: ESQUEMA_OK })
  async revogar(@Req() requisicao: Request, @Param('id') id: string) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    await this.identidade.revogarSessao(ctx, id, new Date());
    return { ok: true };
  }
}
