import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiNoContentResponse, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { kioskConfigSchema } from '@arenahub/api-contracts';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import {
  KioskAdminConfigService,
  type EstadoDaConfiguracao,
} from './kiosk-admin-config.service.js';
import { KioskMediaService } from './kiosk-media.service.js';
import { TAMANHO_MAXIMO_DE_MIDIA_BYTES } from './domain/midia-do-totem.js';
import { TAMANHO_MAXIMO_DE_LOGOTIPO_BYTES } from './domain/logotipo-do-patrocinador.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { z } from 'zod';

/**
 * Corpo de `POST :id/media/from-link`.
 *
 * SO checa que ha texto -- quem decide se a URL e aceitavel e
 * `aceitarLinkDeReel`, no dominio. Repetir a regra aqui criaria duas
 * definicoes de "link valido" que divergem na primeira mudanca, e a do
 * boundary venceria por acidente de ordem.
 */
const esquemaDeLinkDeMidia = z.object({ link: z.string().trim().min(1) }).strict();

/**
 * O arquivo como o `FileInterceptor` o entrega -- mesma declaracao local do
 * `import.controller.ts` (F19), e pela mesma razao: sao tres campos, e
 * `@types/multer` traria uma dependencia inteira para descrever seis linhas.
 */
interface ArquivoRecebido {
  readonly originalname: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
}

interface TotemDto {
  id: string;
  code: string;
  gymUnitId: string;
  lastHeartbeat: string | null;
  bootConfigVersion: number | null;
}

/**
 * Personalizacao do totem -- F50.
 *
 * Modulo SEPARADO do `kiosk`: aquele autentica por HMAC de DISPOSITIVO
 * (`@KioskRoute()`), estas rotas pela sessao do GERENTE. Misturar os dois
 * regimes no mesmo controller e como um totem acaba conseguindo escrever a
 * propria configuracao.
 *
 * Permissao reusa `device.read` / `device.manage`: totem e dispositivo, nao
 * merece familia de permissao propria.
 */
@Controller('api/v1/admin/kiosk-devices')
export class KioskAdminController {
  constructor(
    private readonly config: KioskAdminConfigService,
    private readonly midia: KioskMediaService,
    private readonly contexto: TenantContextService,
    private readonly db: PrismaService,
  ) {}

  @Get()
  @RequirePermissions('device.read')
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object' } } })
  async listar(): Promise<TotemDto[]> {
    const ctx = this.contexto.require();

    const devices = await this.db.kioskDevice.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ code: 'asc' }],
      select: {
        id: true,
        code: true,
        gymUnitId: true,
        lastHeartbeat: true,
        bootConfigVersion: true,
      },
    });

    return devices.map((d) => ({
      id: d.id,
      code: d.code,
      gymUnitId: d.gymUnitId,
      lastHeartbeat: d.lastHeartbeat?.toISOString() ?? null,
      bootConfigVersion: d.bootConfigVersion,
    }));
  }

  @Get(':id/config')
  @RequirePermissions('device.read')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['publicada', 'rascunho', 'efetiva', 'configVersion', 'totemEmSessao'],
      properties: {
        publicada: { type: 'object', nullable: true },
        rascunho: { type: 'object', nullable: true },
        efetiva: { type: 'object' },
        configVersion: { type: 'integer' },
        totemEmSessao: { type: 'boolean' },
      },
    },
  })
  async obter(@Param('id') id: string): Promise<EstadoDaConfiguracao> {
    return this.config.obterEstado(this.contexto.require(), id);
  }

  @Put(':id/config')
  @HttpCode(204)
  @RequirePermissions('device.manage')
  @ApiNoContentResponse({
    schema: { type: 'object', nullable: true, description: 'Sem corpo.' },
  })
  async salvar(@Param('id') id: string, @Body() corpo: unknown): Promise<void> {
    // `unknown` antes de validar. O parse tambem DESCARTA campo estranho no
    // corpo -- e por isso que um `tenantId` enviado pelo cliente nao chega
    // a lugar nenhum.
    const config = kioskConfigSchema.parse(corpo);

    await this.config.salvarRascunho(this.contexto.require(), id, config);
  }

  @Post(':id/config/publish')
  @HttpCode(201)
  @RequirePermissions('device.manage')
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['version'],
      properties: { version: { type: 'integer' } },
    },
  })
  async publicar(@Param('id') id: string): Promise<{ version: number }> {
    return this.config.publicar(this.contexto.require(), id, new Date());
  }

  /**
   * Recebe o MP4 da tela publica (F51, ADR-042 Decisao 7).
   *
   * Devolve so a CHAVE: quem a coloca em `blocos.itens[].midiaKey` e o
   * painel, no rascunho, e o rascunho so vira tela publicada em `publish`.
   * Um upload nao muda o que o totem exibe -- e o que mantem a publicacao
   * versionada como o unico caminho ate a superficie.
   *
   * `limits.fileSize` no interceptor E o teto do dominio ao mesmo tempo: o
   * primeiro corta antes de o buffer inteiro subir a memoria, o segundo diz
   * qual codigo de erro o gerente ve.
   */
  @Post(':id/media')
  @HttpCode(201)
  @RequirePermissions('device.manage')
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['midiaKey'],
      properties: { midiaKey: { type: 'string' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: TAMANHO_MAXIMO_DE_MIDIA_BYTES } }),
  )
  async enviarMidia(
    @Param('id') id: string,
    @UploadedFile() arquivo: ArquivoRecebido | undefined,
  ): Promise<{ midiaKey: string }> {
    if (!arquivo) {
      throw new BadRequestException({ code: 'FILE_REQUIRED' });
    }

    return this.midia.enviar(this.contexto.require(), id, {
      originalFilename: arquivo.originalname,
      contentType: arquivo.mimetype,
      conteudo: new Uint8Array(arquivo.buffer),
    });
  }

  /**
   * Upload do logotipo de um patrocinador (28/08/2026, decisao do PI).
   *
   * ROTA PROPRIA, e nao um parametro de `:id/media`: os dois tetos sao
   * diferentes (2 MB contra 40 MB) e `limits.fileSize` do interceptor e
   * fixado aqui, antes de o corpo subir a memoria. Uma rota so obrigaria a
   * usar o MAIOR teto para os dois, e um PNG de 39 MB chegaria inteiro na
   * memoria antes de o dominio o recusar.
   *
   * Devolve so a CHAVE: quem a coloca em `patrocinio.marcas[].logotipoKey`
   * e o painel, na proxima gravacao do rascunho -- mesma divisao do upload
   * de video.
   */
  @Post(':id/sponsor-logo')
  @HttpCode(201)
  @RequirePermissions('device.manage')
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['midiaKey'],
      properties: { midiaKey: { type: 'string' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: TAMANHO_MAXIMO_DE_LOGOTIPO_BYTES } }),
  )
  async enviarLogotipo(
    @Param('id') id: string,
    @UploadedFile() arquivo: ArquivoRecebido | undefined,
  ): Promise<{ midiaKey: string }> {
    if (!arquivo) {
      throw new BadRequestException({ code: 'FILE_REQUIRED' });
    }

    return this.midia.enviarLogotipo(this.contexto.require(), id, {
      originalFilename: arquivo.originalname,
      contentType: arquivo.mimetype,
      conteudo: new Uint8Array(arquivo.buffer),
    });
  }

  /**
   * Copia um reel do Instagram para a midia da tela publica (ADR-042,
   * Decisao 7).
   *
   * MESMO CONTRATO DO UPLOAD -- devolve a chave, e o painel a coloca no
   * rascunho. Adiciona `linkExterno` porque o bloco guarda a URL CANONICA,
   * nao a que o gerente colou: o botao "copiar link" do app traz query de
   * rastreamento, e o mesmo reel copiado de dois lugares viraria dois links.
   *
   * `POST` e nao `PUT` mesmo sendo repetivel: cada chamada BAIXA de novo e
   * gera chave nova (o `randomUUID` de `montarChaveDeMidia`). E o que faz o
   * botao "atualizar midia" do painel funcionar -- rechamar traz a versao
   * atual do reel.
   *
   * O download acontece AQUI, no painel, com o gerente olhando (trava 1 do
   * ADR). Nenhuma rota do totem extrai coisa nenhuma.
   */
  @Post(':id/media/from-link')
  @HttpCode(201)
  @RequirePermissions('device.manage')
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['midiaKey', 'linkExterno'],
      properties: { midiaKey: { type: 'string' }, linkExterno: { type: 'string' } },
    },
  })
  async ingerirMidiaDeLink(
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<{ midiaKey: string; linkExterno: string }> {
    const { link } = esquemaDeLinkDeMidia.parse(corpo);

    return this.midia.ingerirDeLink(this.contexto.require(), id, link);
  }

  @Delete(':id/config/draft')
  @HttpCode(204)
  @RequirePermissions('device.manage')
  @ApiNoContentResponse({
    schema: { type: 'object', nullable: true, description: 'Sem corpo.' },
  })
  async descartar(@Param('id') id: string): Promise<void> {
    await this.config.descartarRascunho(this.contexto.require(), id);
  }
}
