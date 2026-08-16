import { Body, Controller, Get, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { DataExportJob } from '@arenahub/database';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { PERIODO_PADRAO_HORAS } from '../access-query/access-query.repository.js';
import { ExportsService } from './exports.service.js';

const esquemaDeExportacao = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    gymUnitId: z.string().uuid().optional(),
    studentId: z.string().uuid().optional(),
    outcome: z.enum(['ALLOW', 'DENY']).optional(),
    mode: z.enum(['ONLINE', 'OFFLINE', 'OVERRIDE']).optional(),
    idempotencyKey: z.string().min(8).max(120),
  })
  .strict();

interface ExportacaoDto {
  id: string;
  status: string;
  rowCount: number;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

@Controller('api/v1')
export class ExportsController {
  constructor(
    private readonly exportacoes: ExportsService,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * Pede uma exportacao. Responde na hora; o arquivo fica pronto depois.
   *
   * 202 seria o codigo semanticamente ideal, mas o Nest devolve 201 no `POST`
   * por padrao e o corpo ja diz `status: PENDING`. Mudar o status HTTP so
   * para agradar a semantica custaria um decorator em cada rota e ganharia
   * pouco -- quem consome le o `status`, nao o codigo.
   */
  @Post('access-events/exports')
  @RequirePermissions('access.read')
  async solicitar(@Body() corpo: unknown, @Req() requisicao: Request): Promise<ExportacaoDto> {
    const dados = esquemaDeExportacao.parse(corpo);

    const ate = dados.to ? new Date(dados.to) : new Date();
    const de = dados.from
      ? new Date(dados.from)
      : new Date(ate.getTime() - PERIODO_PADRAO_HORAS * 3_600_000);

    const { job } = await this.exportacoes.solicitar(this.contexto.require(), {
      filtro: {
        de,
        ate,
        gymUnitId: dados.gymUnitId,
        studentId: dados.studentId,
        outcome: dados.outcome,
        mode: dados.mode,
      },
      periodoExplicito: dados.from !== undefined || dados.to !== undefined,
      idempotencyKey: dados.idempotencyKey,
      correlationId: requisicao.correlationId ?? 'sem-correlacao',
    });

    return this.paraDto(job);
  }

  @Get('exports/:id')
  @RequirePermissions('access.read')
  async consultar(@Param('id') id: string): Promise<ExportacaoDto> {
    const job = await this.exportacoes.encontrar(this.contexto.require(), id);

    if (!job) throw new NotFoundException({ code: 'EXPORT_NOT_FOUND' });

    return this.paraDto(job);
  }

  @Post('exports/:id/cancel')
  @RequirePermissions('access.read')
  async cancelar(@Param('id') id: string): Promise<ExportacaoDto> {
    const job = await this.exportacoes.cancelar(this.contexto.require(), id);

    if (!job) throw new NotFoundException({ code: 'EXPORT_NOT_FOUND' });

    return this.paraDto(job);
  }

  /**
   * URL de download, curta e assinada.
   *
   * A API NAO devolve o arquivo: devolve o link. O CSV vai do storage direto
   * ao navegador, sem passar por aqui -- menos um lugar por onde dado de
   * acesso trafega e fica em buffer.
   */
  @Post('exports/:id/download')
  @RequirePermissions('access.read')
  async baixar(
    @Param('id') id: string,
    @Req() requisicao: Request,
  ): Promise<{ downloadUrl: string; expiresAt: string }> {
    return this.exportacoes.gerarDownload(
      this.contexto.require(),
      id,
      requisicao.correlationId ?? 'sem-correlacao',
    );
  }

  private paraDto(job: DataExportJob): ExportacaoDto {
    return {
      id: job.id,
      status: job.status,
      rowCount: job.rowCount,
      errorCode: job.errorCode,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
      expiresAt: job.expiresAt?.toISOString() ?? null,
    };
  }
}
