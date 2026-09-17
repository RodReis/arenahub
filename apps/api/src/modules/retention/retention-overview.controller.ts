import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { RetentionOverviewService, type VisaoGeralDeRetencao } from './retention-overview.service.js';

interface PipelineDto {
  state: string;
  hoursSinceLastRun: number | null;
}

interface OverviewDto {
  pipeline: PipelineDto;
  riskQueue: Record<string, number>;
  taskQueue: Record<string, number>;
}

const ESQUEMA_DE_RESPOSTA = {
  type: 'object',
  properties: {
    pipeline: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['SAUDAVEL', 'ATRASADO', 'DESLIGADO', 'NUNCA_RODOU'] },
        hoursSinceLastRun: { type: 'integer', nullable: true },
      },
    },
    riskQueue: {
      type: 'object',
      properties: {
        BAIXO: { type: 'integer' },
        MEDIO: { type: 'integer' },
        ALTO: { type: 'integer' },
        CRITICO: { type: 'integer' },
      },
    },
    taskQueue: { type: 'object', additionalProperties: { type: 'integer' } },
  },
};

/**
 * Leitura agregada da tela `/retention/overview` (F75, SPEC-075 §3.2).
 *
 * MESMA PERMISSAO DA F37 -- `retention.read`. Nao ha capacidade nova: quem
 * ja ve a fila de risco e a fila de tarefas ve a mesma coisa agregada.
 */
@Controller('api/v1/retention')
export class RetentionOverviewController {
  constructor(
    private readonly contexto: TenantContextService,
    private readonly overview: RetentionOverviewService,
  ) {}

  @Get('overview')
  @RequirePermissions('retention.read')
  @ApiOkResponse({ schema: ESQUEMA_DE_RESPOSTA })
  async visaoGeral(): Promise<OverviewDto> {
    const visao = await this.overview.visaoGeral(this.contexto.require(), new Date());

    return paraDto(visao);
  }
}

function paraDto(visao: VisaoGeralDeRetencao): OverviewDto {
  return {
    pipeline: { state: visao.pipeline.estado, hoursSinceLastRun: visao.pipeline.horasSemRodar },
    riskQueue: visao.filaDeRisco,
    taskQueue: visao.filaDeTarefas,
  };
}
