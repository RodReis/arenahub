import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';

import { PlatformContextService } from '../../common/platform/platform-context.service.js';
import { PlatformRoute } from '../../common/security/platform-route.decorator.js';
import { CriarTenantUseCase } from './criar-tenant.use-case.js';
import { esquemaDeCriacaoDeTenant } from './dto/criar-tenant.dto.js';
import { EmailDeConviteService } from '../iam/email-de-convite.service.js';
import { TenantRepository } from './tenant.repository.js';

const ESQUEMA_DO_TENANT_NA_LISTA = {
  type: 'object',
  required: ['id', 'slug', 'displayName', 'status', 'unidades'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    slug: { type: 'string' },
    displayName: { type: 'string' },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
    unidades: { type: 'integer' },
  },
};

const ESQUEMA_DO_TENANT_CRIADO = {
  type: 'object',
  required: ['id', 'gymUnitId', 'emailEnviado'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    gymUnitId: { type: 'string', format: 'uuid' },
    emailEnviado: { type: 'boolean' },
  },
};

/**
 * Superficie do dono do SaaS.
 *
 * `@PlatformRoute()` na CLASSE: cada rota nova aqui nasce protegida, sem
 * depender de alguem lembrar de decorar o metodo.
 */
@Controller('api/v1/platform')
@PlatformRoute()
export class PlatformController {
  constructor(
    private readonly contexto: PlatformContextService,
    private readonly criarTenant: CriarTenantUseCase,
    private readonly tenants: TenantRepository,
    private readonly emails: EmailDeConviteService,
  ) {}

  @Get('tenants')
  @ApiOkResponse({ schema: { type: 'array', items: ESQUEMA_DO_TENANT_NA_LISTA } })
  async listar(): Promise<
    Array<{ id: string; slug: string; displayName: string; status: string; unidades: number }>
  > {
    const encontrados = await this.tenants.listar();

    // DTO explicito: `cnpj` e `responsavelEmail` ficam de fora da lista --
    // ela e visao de painel, nao dump da tabela.
    return encontrados.map((tenant) => ({
      id: tenant.id,
      slug: tenant.slug,
      displayName: tenant.displayName,
      status: tenant.status,
      unidades: tenant._count.gymUnits,
    }));
  }

  @Post('tenants')
  @ApiCreatedResponse({ schema: ESQUEMA_DO_TENANT_CRIADO })
  async criar(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ id: string; gymUnitId: string; emailEnviado: boolean }> {
    const entrada = esquemaDeCriacaoDeTenant.parse(corpo);

    const resultado = await this.criarTenant.executar(
      this.contexto.require(),
      entrada,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    /*
     * FORA DA TRANSACAO, como o `iam.controller` ja faz: e-mail que falha nao
     * pode desfazer o tenant criado. `enviar` nunca lanca -- devolve se saiu,
     * e a tela diz a verdade para quem cadastrou.
     */
    const envio = await this.emails.enviar(entrada.responsavelEmail, resultado.ownerInvitationToken);

    return {
      id: resultado.tenantId,
      gymUnitId: resultado.gymUnitId,
      emailEnviado: envio.enviado,
    };
  }
}
