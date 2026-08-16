import { Controller, Get, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import type { OperationalAlert } from '@arenahub/database';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { OperationsRepository, type PanoramaOperacional } from './operations.repository.js';

const esquemaDeListagem = z
  .object({
    /** `true` esconde os resolvidos. Padrao do painel. */
    open: z.enum(['true', 'false']).default('true'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

interface AlertaDto {
  id: string;
  code: string;
  severity: string;
  state: string;
  resource: string;
  resourceId: string;
  gymUnitId: string | null;
  impact: string;
  recommendedAction: string;
  evidence: unknown;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

/**
 * Painel operacional -- `M1-AC-011`.
 *
 * O aceite da Slice 1.6 e literal: *"equipe opera um turno completo sem
 * acesso direto a banco, terminal ou logs brutos"*. Estas rotas sao o que
 * torna isso possivel -- se algo so pode ser respondido por `psql`, falta
 * endpoint aqui.
 */
@Controller('api/v1/operations')
export class OperationsController {
  constructor(
    private readonly operacoes: OperationsRepository,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * Panorama da operacao: Edges, dispositivos, sync e acesso.
   *
   * `access.read` e a permissao: quem opera o turno precisa ver, e ver nao e
   * o mesmo que poder abrir a catraca (`access.override`).
   */
  @Get('overview')
  @RequirePermissions('access.read')
  async panorama(): Promise<PanoramaOperacional> {
    return this.operacoes.panorama(this.contexto.require());
  }

  @Get('alerts')
  @RequirePermissions('access.read')
  async listarAlertas(@Query() consulta: unknown): Promise<AlertaDto[]> {
    const filtro = esquemaDeListagem.parse(consulta);

    const alertas = await this.operacoes.listar(this.contexto.require(), {
      apenasAbertos: filtro.open === 'true',
      limite: filtro.limit,
    });

    return alertas.map((a) => this.paraDto(a));
  }

  /**
   * Reconhece um alerta: "estou vendo, estou indo".
   *
   * NAO RESOLVE. A condicao continua sendo avaliada a cada 30 s -- se o Edge
   * ainda estiver fora, o alerta continua no painel, agora marcado como
   * reconhecido. Deixar o operador fechar um alarme ativo transformaria o
   * painel numa lista do que alguem clicou, nao do que esta acontecendo.
   */
  @Post('alerts/:id/acknowledge')
  @RequirePermissions('access.read')
  async reconhecer(@Param('id') id: string, @Req() requisicao: Request): Promise<AlertaDto> {
    const alerta = await this.operacoes.reconhecer(
      this.contexto.require(),
      id,
      new Date(),
      requisicao.correlationId ?? 'sem-correlacao',
    );

    // 404 indistinguivel para id inexistente e id de outro tenant: a
    // diferenca revelaria que o alerta existe em algum lugar.
    if (!alerta) throw new NotFoundException({ code: 'OPERATIONAL_ALERT_NOT_FOUND' });

    return this.paraDto(alerta);
  }

  private paraDto(alerta: OperationalAlert): AlertaDto {
    return {
      id: alerta.id,
      code: alerta.code,
      severity: alerta.severity,
      state: alerta.state,
      resource: alerta.resource,
      resourceId: alerta.resourceId,
      gymUnitId: alerta.gymUnitId,
      impact: alerta.impact,
      recommendedAction: alerta.recommendedAction,
      evidence: alerta.evidence,
      firstSeenAt: alerta.firstSeenAt.toISOString(),
      lastSeenAt: alerta.lastSeenAt.toISOString(),
      acknowledgedAt: alerta.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: alerta.resolvedAt?.toISOString() ?? null,
    };
  }
}
