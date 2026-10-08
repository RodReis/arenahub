import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';

import { ConfiguracaoDePagamentoUseCase } from './configuracao-de-pagamento.use-case.js';
import type { ConfiguracaoDePagamento } from './domain/configuracao-de-pagamento.js';

/** Os TRES campos, sempre: a regra `gerar <= vencer` olha o conjunto. */
const esquema = z
  .object({
    invoiceGenerationDay: z.number().int(),
    dueDay: z.number().int(),
    graceDays: z.number().int(),
  })
  .strict();

const ESQUEMA_DA_CONFIGURACAO = {
  type: 'object',
  required: ['invoiceGenerationDay', 'dueDay', 'graceDays'],
  properties: {
    invoiceGenerationDay: { type: 'integer' },
    dueDay: { type: 'integer' },
    graceDays: { type: 'integer' },
  },
};

@Controller('api/v1/billing/settings')
export class ConfiguracaoDePagamentoController {
  constructor(
    private readonly configuracao: ConfiguracaoDePagamentoUseCase,
    private readonly contexto: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('billing.read')
  @ApiOkResponse({ schema: ESQUEMA_DA_CONFIGURACAO })
  async obter(): Promise<ConfiguracaoDePagamento> {
    return this.configuracao.obter(this.contexto.require().tenantId);
  }

  @Put()
  @RequirePermissions('billing.settings.manage')
  @ApiOkResponse({ schema: ESQUEMA_DA_CONFIGURACAO })
  async salvar(@Body() corpo: unknown, @Req() requisicao: Request): Promise<ConfiguracaoDePagamento> {
    return this.configuracao.salvar(
      this.contexto.require(),
      esquema.parse(corpo),
      requisicao.correlationId ?? 'sem-correlacao',
    );
  }
}
