import { Controller, Get, Headers, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { StudentSessionGuard } from '../student-identity/student-session.guard.js';
import { MobileHomeService } from './mobile-home.service.js';

const ESQUEMA_DA_HOME = {
  type: 'object',
  properties: {
    asOf: { type: 'string' },
    status: { type: 'string', enum: ['AVAILABLE', 'UNAVAILABLE'] },
    saudacao: { type: 'string' },
    versionPolicy: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['SUPPORTED', 'GRACE', 'BLOCKED'] },
        updateUrl: { type: 'string', nullable: true },
      },
      required: ['state', 'updateUrl'],
    },
  },
  required: ['asOf', 'status', 'saudacao', 'versionPolicy'],
};

/**
 * A Home do app -- Slice 4.1, o "shell util" do `M4-NFR-002`.
 *
 * SEM DADO DE NEGOCIO nesta fatia. Plano, fatura e frequencia sao das Slices
 * 4.2 e 4.3; antecipa-los aqui criaria um contrato que aquelas fatias teriam
 * de honrar ou quebrar.
 */
@Public()
@UseGuards(StudentSessionGuard)
@Controller('api/v1/mobile/home')
export class MobileHomeController {
  constructor(private readonly home: MobileHomeService) {}

  /**
   * `x-app-version` decide a politica de versao -- F29, `M4-NFR-008`.
   *
   * Header, e nao query nem corpo: e metadado do CLIENTE, vale para toda
   * chamada, e poe-lo no corpo faria cada endpoint futuro repetir o campo.
   * Ausente resulta em `BLOCKED` -- cliente que nao se identifica e cliente
   * desconhecido, e liberar o desconhecido esvaziaria a politica: bastaria
   * omitir o header para escapar dela.
   */
  @Get()
  @ApiHeader({ name: 'x-app-version', required: false, description: 'Versao do app (1.4.0).' })
  @ApiOkResponse({ description: 'Home do aluno.', schema: ESQUEMA_DA_HOME })
  async obter(@Req() requisicao: Request, @Headers('x-app-version') versaoDoApp?: string) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    return this.home.montar(ctx, new Date(), versaoDoApp);
  }
}
