import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { RetentionMonitoringService } from './retention-monitoring.service.js';

const esquemaDoKillSwitch = z.object({ enabled: z.boolean() }).strict();

interface PainelDto {
  pipeline: { state: string; hoursSinceLastRun: number | null };
  drift: {
    feature: string;
    type: string;
    severity: string;
    change: number;
    before: number;
    after: number;
  }[];
  needsAttention: boolean;
}

const ESQUEMA_DO_PAINEL = {
  type: 'object',
  properties: {
    pipeline: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['SAUDAVEL', 'ATRASADO', 'DESLIGADO', 'NUNCA_RODOU'],
        },
        hoursSinceLastRun: { type: 'integer', nullable: true },
      },
    },
    drift: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string' },
          type: { type: 'string', enum: ['AUSENCIA', 'MEDIA'] },
          severity: { type: 'string', enum: ['ATENCAO', 'CRITICO'] },
          change: { type: 'number' },
          before: { type: 'number' },
          after: { type: 'number' },
        },
      },
    },
    needsAttention: { type: 'boolean' },
  },
};

const ESQUEMA_VAZIO = { type: 'object', properties: {} };

/**
 * Produção controlada do scoring de retenção (F41, Slice 6.6).
 *
 * ---------------------------------------------------------------------------
 * O KILL SWITCH É PERMISSÃO PRÓPRIA
 * ---------------------------------------------------------------------------
 *
 * `retention.kill_switch` segue o precedente dos atos excepcionais do
 * repositório (`access.override`, `billing.refund`, `billing.override.financial`):
 * ler o painel é trabalho de acompanhamento; **parar o scoring da academia
 * inteira** é decisão de operação, e nem todo perfil que consulta precisa
 * poder fazê-la.
 */
@Controller('api/v1/retention')
export class RetentionMonitoringController {
  constructor(
    private readonly contexto: TenantContextService,
    private readonly monitoramento: RetentionMonitoringService,
  ) {}

  @Get('health')
  @RequirePermissions('retention.read')
  @ApiOkResponse({ schema: ESQUEMA_DO_PAINEL })
  async painel(): Promise<PainelDto> {
    const painel = await this.monitoramento.painel(this.contexto.require(), new Date());

    return {
      pipeline: {
        state: painel.pipeline.estado,
        hoursSinceLastRun: painel.pipeline.horasSemRodar,
      },
      drift: painel.drift.map((achado) => ({
        feature: achado.feature,
        type: achado.tipo,
        severity: achado.severidade,
        change: achado.variacao,
        before: achado.antes,
        after: achado.depois,
      })),
      needsAttention: painel.precisaDeAtencao,
    };
  }

  @Post('scoring/kill-switch')
  @RequirePermissions('retention.kill_switch')
  @ApiOkResponse({ schema: ESQUEMA_VAZIO })
  async definir(@Body() corpo: unknown): Promise<Record<string, never>> {
    const parsed = esquemaDoKillSwitch.safeParse(corpo);

    if (!parsed.success) {
      throw new BadRequestException('KILL_SWITCH_INVALIDO');
    }

    await this.monitoramento.definirScoring(this.contexto.require(), parsed.data.enabled);
    return {};
  }
}
