import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { StudentSessionGuard } from '../student-identity/student-session.guard.js';
import {
  MobileConsentimentosService,
  TIPOS_DO_APP,
  type TipoDeConsentimentoDoApp,
} from './mobile-consentimentos.service.js';

const esquemaDaDecisao = z.object({
  tipo: z.enum(TIPOS_DO_APP),
  conceder: z.boolean(),
});

const ESQUEMA_DO_CONSENTIMENTO = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: [...TIPOS_DO_APP] },
    concedido: { type: 'boolean' },
    motivo: { type: 'string', nullable: true },
    decididoEm: { type: 'string', nullable: true },
    finalidade: { type: 'string', nullable: true },
    versao: { type: 'number', nullable: true },
    editavel: { type: 'boolean' },
  },
  required: ['tipo', 'concedido', 'motivo', 'decididoEm', 'finalidade', 'versao', 'editavel'],
};

/**
 * O aluno gere os proprios consentimentos -- Slice 4.4, `M4-BR-009`.
 *
 * `PUT` e nao `POST`: a decisao e o estado do consentimento daquele tipo, e
 * repetir a mesma chamada nao muda nada alem de gravar uma linha nova de
 * prova. O historico e append-only por baixo (INV-021); a chamada e que e
 * idempotente em efeito.
 */
@Public()
@UseGuards(StudentSessionGuard)
@Controller('api/v1/mobile/consentimentos')
export class MobileConsentimentosController {
  constructor(private readonly consentimentos: MobileConsentimentosService) {}

  @Get()
  @ApiOkResponse({
    description: 'Consentimentos do aluno.',
    schema: {
      type: 'object',
      properties: {
        asOf: { type: 'string' },
        consentimentos: { type: 'array', items: ESQUEMA_DO_CONSENTIMENTO },
      },
      required: ['asOf', 'consentimentos'],
    },
  })
  async listar(@Req() requisicao: Request) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    return this.consentimentos.listar(ctx, new Date());
  }

  @Put()
  @ApiOkResponse({
    description: 'Consentimento apos a decisao.',
    schema: ESQUEMA_DO_CONSENTIMENTO,
  })
  async decidir(@Req() requisicao: Request, @Body() corpo: unknown) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    const dados = esquemaDaDecisao.parse(corpo);

    return this.consentimentos.decidir(
      ctx,
      dados.tipo satisfies TipoDeConsentimentoDoApp,
      dados.conceder,
      requisicao.correlationId ?? 'sem-correlacao',
      new Date(),
    );
  }
}
