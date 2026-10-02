import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Put } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import {
  AppDistributionRepository,
  SlugDoLinkEmUsoError,
  type IdentidadeDoApp,
  type InstaladorAndroid,
} from './app-distribution.repository.js';
import {
  LIMITE_DA_MENSAGEM,
  LIMITE_DA_VERSAO,
  slugDoLinkValido,
  urlDeInstaladorValida,
} from './domain/instalador-android.js';

const esquemaDoInstalador = z
  .object({
    androidUrl: z.string(),
    androidVersion: z.string().trim().max(LIMITE_DA_VERSAO).nullish(),
    shortSlug: z.string().refine(slugDoLinkValido).optional(),
    messageTemplate: z.string().max(LIMITE_DA_MENSAGEM).nullish(),
  })
  .strict();

const ESQUEMA_DA_RESPOSTA = {
  type: 'object',
  required: [
    'androidUrl',
    'androidVersion',
    'updatedAt',
    'updatedByEmail',
    'updatedByRole',
    'shortSlug',
    'messageTemplate',
    'academia',
    'slugSugerido',
  ],
  properties: {
    shortSlug: { type: 'string', nullable: true },
    messageTemplate: { type: 'string', nullable: true },
    academia: { type: 'string' },
    slugSugerido: { type: 'string' },
    androidUrl: { type: 'string', nullable: true },
    androidVersion: { type: 'string', nullable: true },
    updatedAt: { type: 'string', format: 'date-time', nullable: true },
    updatedByEmail: { type: 'string', nullable: true },
    updatedByRole: { type: 'string', nullable: true },
  },
};

function paraDto(linha: InstaladorAndroid | null, identidade: IdentidadeDoApp) {
  return {
    androidUrl: linha?.androidUrl ?? null,
    androidVersion: linha?.androidVersion ?? null,
    updatedAt: linha?.updatedAt.toISOString() ?? null,
    updatedByEmail: linha?.updatedByEmail ?? null,
    updatedByRole: linha?.updatedByRole ?? null,
    shortSlug: identidade.shortSlug,
    messageTemplate: linha?.messageTemplate ?? null,
    academia: identidade.academia,
    slugSugerido: identidade.slugSugerido,
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
    const contexto = this.contexto.require();
    const [linha, identidade] = await Promise.all([
      this.instalador.obter(contexto),
      this.instalador.identidade(contexto),
    ]);

    return paraDto(linha, identidade);
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

    const contexto = this.contexto.require();
    let salvo: InstaladorAndroid;
    try {
      salvo = await this.instalador.salvar(contexto, {
        androidUrl: dados.androidUrl,
        androidVersion: dados.androidVersion ? dados.androidVersion : null,
        ...(dados.shortSlug !== undefined ? { shortSlug: dados.shortSlug } : {}),
        // Vazio = volta ao texto padrao do painel.
        ...(dados.messageTemplate !== undefined
          ? { messageTemplate: dados.messageTemplate?.trim() ? dados.messageTemplate : null }
          : {}),
      });
    } catch (erro) {
      if (erro instanceof SlugDoLinkEmUsoError) {
        throw new ConflictException({ code: 'APP_LINK_SLUG_TAKEN' });
      }
      throw erro;
    }

    return paraDto(salvo, await this.instalador.identidade(contexto));
  }

  /** Idempotente; devolve o estado vazio, o mesmo de um GET depois. */
  @Delete()
  @RequirePermissions('user.manage')
  @ApiOkResponse({ schema: ESQUEMA_DA_RESPOSTA })
  async remover() {
    const contexto = this.contexto.require();
    await this.instalador.remover(contexto);

    return paraDto(null, await this.instalador.identidade(contexto));
  }
}
