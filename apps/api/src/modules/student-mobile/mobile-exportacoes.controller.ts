import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { DataExportJob } from '@arenahub/database';
import type { Request } from 'express';
import { z } from 'zod';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { HealthExportService } from '../health/health-export.service.js';
import { StudentSessionGuard } from '../student-identity/student-session.guard.js';
import { tenantContextDoAluno } from './contexto-do-aluno.js';

const esquemaDoPedido = z.object({
  // Vem do CLIENTE, e e ele quem garante que o retry usa a mesma: um id
  // gerado aqui faria cada toque no botao virar um pedido novo, que e
  // exatamente o que a idempotencia existe para impedir.
  idempotencyKey: z.string().min(8).max(120),
});

const ESQUEMA_DA_EXPORTACAO = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] },
    rowCount: { type: 'number' },
    errorCode: { type: 'string', nullable: true },
    expiresAt: { type: 'string', nullable: true },
  },
  required: ['id', 'status', 'rowCount', 'errorCode', 'expiresAt'],
};

function paraDto(job: DataExportJob) {
  return {
    id: job.id,
    status: job.status,
    rowCount: job.rowCount,
    errorCode: job.errorCode,
    expiresAt: job.expiresAt?.toISOString() ?? null,
  };
}

/**
 * O aluno leva o proprio historico embora -- Slice 4.4, `M4-FR-013`.
 *
 * ASSINCRONO: o pedido devolve o job na hora, o app acompanha ate
 * `COMPLETED` e so entao pede o link. O motivo de nao ser sincrono esta no
 * cabecalho do `HealthExportService`.
 *
 * `requesterId` e o PROPRIO ALUNO, nao um usuario de painel. E o que isola a
 * idempotencia por titular e o que faz `consultar` recusar o job de outro
 * aluno mesmo dentro do mesmo tenant -- sem isso, um id de job adivinhado
 * daria o historico de saude alheio.
 */
@Public()
@UseGuards(StudentSessionGuard)
@Controller('api/v1/mobile/exportacoes')
export class MobileExportacoesController {
  constructor(private readonly exportacoes: HealthExportService) {}

  @Post()
  @ApiOkResponse({ description: 'Pedido registrado.', schema: ESQUEMA_DA_EXPORTACAO })
  async solicitar(@Req() requisicao: Request, @Body() corpo: unknown) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    const dados = esquemaDoPedido.parse(corpo);

    const job = await this.exportacoes.solicitar(
      tenantContextDoAluno(ctx),
      ctx.studentId,
      ctx.studentId,
      dados.idempotencyKey,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return paraDto(job);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Estado do pedido.', schema: ESQUEMA_DA_EXPORTACAO })
  async consultar(@Req() requisicao: Request, @Param('id') jobId: string) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    return paraDto(
      await this.exportacoes.consultar(tenantContextDoAluno(ctx), jobId, ctx.studentId),
    );
  }

  @Post(':id/download')
  @ApiOkResponse({
    description: 'Link temporario do arquivo.',
    schema: {
      type: 'object',
      properties: { downloadUrl: { type: 'string' }, expiresAt: { type: 'string' } },
      required: ['downloadUrl', 'expiresAt'],
    },
  })
  async baixar(@Req() requisicao: Request, @Param('id') jobId: string) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    return this.exportacoes.baixar(tenantContextDoAluno(ctx), jobId, ctx.studentId);
  }
}
