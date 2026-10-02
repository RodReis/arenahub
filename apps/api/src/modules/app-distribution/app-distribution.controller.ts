import { BadRequestException, Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { AppDistributionRepository, type InstaladorAndroid } from './app-distribution.repository.js';
import { LIMITE_DA_VERSAO, urlDeInstaladorValida } from './domain/instalador-android.js';

const esquemaDoInstalador = z
  .object({
    androidUrl: z.string(),
    androidVersion: z.string().trim().max(LIMITE_DA_VERSAO).nullish(),
  })
  .strict();

const ESQUEMA_DA_RESPOSTA = {
  type: 'object',
  required: ['androidUrl', 'androidVersion', 'updatedAt', 'updatedByEmail', 'updatedByRole'],
  properties: {
    androidUrl: { type: 'string', nullable: true },
    androidVersion: { type: 'string', nullable: true },
    updatedAt: { type: 'string', format: 'date-time', nullable: true },
    updatedByEmail: { type: 'string', nullable: true },
    updatedByRole: { type: 'string', nullable: true },
  },
};

function paraDto(linha: InstaladorAndroid | null) {
  return {
    androidUrl: linha?.androidUrl ?? null,
    androidVersion: linha?.androidVersion ?? null,
    updatedAt: linha?.updatedAt.toISOString() ?? null,
    updatedByEmail: linha?.updatedByEmail ?? null,
    updatedByRole: linha?.updatedByRole ?? null,
  };
}

/**
 * Instalador Android da academia -- issue #534. O tenant vem SEMPRE da
 * identidade autenticada; o corpo e `.strict()`, entao `tenantId` la dentro
 * vira 400 em vez de ser ignorado em silencio.
 */
@Controller('api/v1/app-distribution')
export class AppDistributionController {
  constructor(
    private readonly instalador: AppDistributionRepository,
    private readonly contexto: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('student.read')
  @ApiOkResponse({ schema: ESQUEMA_DA_RESPOSTA })
  async obter() {
    return paraDto(await this.instalador.obter(this.contexto.require()));
  }

  @Put()
  @RequirePermissions('user.manage')
  @ApiOkResponse({ schema: ESQUEMA_DA_RESPOSTA })
  async salvar(@Body() corpo: unknown) {
    const dados = esquemaDoInstalador.parse(corpo);

    // O valor da URL NUNCA entra na mensagem: log de erro com o link colado
    // vira vazamento no dia em que alguem cola o link errado.
    if (!urlDeInstaladorValida(dados.androidUrl)) {
      throw new BadRequestException({ code: 'APP_DISTRIBUTION_URL_INVALID' });
    }

    const salvo = await this.instalador.salvar(this.contexto.require(), {
      androidUrl: dados.androidUrl,
      androidVersion: dados.androidVersion ? dados.androidVersion : null,
    });

    return paraDto(salvo);
  }

  /** Idempotente; devolve o estado vazio, o mesmo de um GET depois. */
  @Delete()
  @RequirePermissions('user.manage')
  @ApiOkResponse({ schema: ESQUEMA_DA_RESPOSTA })
  async remover() {
    await this.instalador.remover(this.contexto.require());

    return paraDto(null);
  }
}
