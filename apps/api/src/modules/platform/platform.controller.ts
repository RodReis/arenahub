import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { PlatformContextService } from '../../common/platform/platform-context.service.js';
import { PlatformRoute } from '../../common/security/platform-route.decorator.js';
import { COOKIE_DE_ACESSO } from '../auth/cookies.js';
import { AlterarTenantUseCase, TenantNaoEncontradoError } from './alterar-tenant.use-case.js';
import { CriarTenantUseCase } from './criar-tenant.use-case.js';
import { esquemaDeAlteracaoDeTenant } from './dto/alterar-tenant.dto.js';
import { esquemaDeCriacaoDeTenant } from './dto/criar-tenant.dto.js';
import { esquemaDeElevacao } from './dto/elevar.dto.js';
import { ElevarUseCase } from './elevar.use-case.js';
import { EncerrarElevacaoUseCase } from './encerrar-elevacao.use-case.js';
import { EmailDeConviteService } from '../iam/email-de-convite.service.js';
import { BrandingService } from './branding.service.js';
import { TAMANHO_MAXIMO_DE_IDENTIDADE_BYTES } from './domain/identidade-visual.js';
import { TenantRepository } from './tenant.repository.js';

/**
 * O arquivo como o `FileInterceptor` o entrega -- mesma declaracao local do
 * `import.controller.ts` e do `kiosk-admin.controller.ts`, e pela mesma razao:
 * sao tres campos, e `@types/multer` traria uma dependencia inteira para
 * descrever seis linhas.
 */
interface ArquivoRecebido {
  readonly originalname: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
}

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

/**
 * Detalhe do tenant. Carrega o que a LISTA omite -- `cnpj`, `timezone` e o
 * responsavel --, porque e ele que alimenta o formulario de edicao. Sem esses
 * campos o formulario nasceria em branco e salvar apagaria o que ninguem pediu
 * para apagar.
 */
const ESQUEMA_DO_TENANT_EM_DETALHE = {
  type: 'object',
  required: ['id', 'slug', 'displayName', 'legalName', 'status', 'unidades'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    slug: { type: 'string' },
    displayName: { type: 'string' },
    legalName: { type: 'string' },
    cnpj: { type: 'string', nullable: true },
    timezone: { type: 'string', nullable: true },
    responsavelNome: { type: 'string', nullable: true },
    responsavelEmail: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
    unidades: { type: 'integer' },
    missionText: { type: 'string', nullable: true },
    highlightsText: { type: 'string', nullable: true },
    temLogo: { type: 'boolean' },
    temIcone: { type: 'boolean' },
  },
};

const ESQUEMA_DO_ARQUIVO_ENVIADO = {
  type: 'object',
  required: ['objectKey'],
  properties: { objectKey: { type: 'string' } },
};

const ESQUEMA_DO_TENANT_ALTERADO = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
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

const ESQUEMA_DA_ELEVACAO = {
  type: 'object',
  required: ['id', 'expiresAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    expiresAt: { type: 'string', format: 'date-time' },
  },
};

const ESQUEMA_DA_SAIDA_DE_ELEVACAO = {
  type: 'object',
  required: ['encerrada'],
  properties: { encerrada: { type: 'boolean' } },
};

/** Mesma vida do access token emitido pelo `TokenService`. */
const ACESSO_VALIDO_POR_MS = 10 * 60 * 1000;

/** Mesmas opcoes do `auth.controller`: HttpOnly, SameSite=Strict, HTTPS fora de dev. */
const OPCOES_DE_COOKIE = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env['NODE_ENV'] === 'production',
  path: '/',
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
    private readonly alterarTenant: AlterarTenantUseCase,
    private readonly tenants: TenantRepository,
    private readonly emails: EmailDeConviteService,
    private readonly elevar: ElevarUseCase,
    private readonly encerrarElevacao: EncerrarElevacaoUseCase,
    private readonly branding: BrandingService,
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

  @Get('tenants/:id')
  @ApiOkResponse({ schema: ESQUEMA_DO_TENANT_EM_DETALHE })
  async detalhar(@Param('id') id: string): Promise<{
    id: string;
    slug: string;
    displayName: string;
    legalName: string;
    cnpj: string | null;
    timezone: string | null;
    responsavelNome: string | null;
    responsavelEmail: string | null;
    status: string;
    unidades: number;
    missionText: string | null;
    highlightsText: string | null;
    temLogo: boolean;
    temIcone: boolean;
  }> {
    const tenant = await this.tenants.porId(id);

    if (!tenant) throw new TenantNaoEncontradoError();

    return {
      id: tenant.id,
      slug: tenant.slug,
      displayName: tenant.displayName,
      legalName: tenant.legalName,
      cnpj: tenant.cnpj,
      timezone: tenant.timezone,
      responsavelNome: tenant.responsavelNome,
      responsavelEmail: tenant.responsavelEmail,
      status: tenant.status,
      unidades: tenant._count.gymUnits,
      missionText: tenant.missionText,
      highlightsText: tenant.highlightsText,
      // BOOLEANO, e nao a chave: a chave e caminho interno do bucket. O
      // formulario so precisa saber se ja ha arquivo para dizer "trocar" em
      // vez de "enviar", e a pre-visualizacao vem pela rota publica.
      temLogo: tenant.logoObjectKey !== null,
      temIcone: tenant.iconObjectKey !== null,
    };
  }

  /**
   * Substitui o logo ou o icone da academia -- F62 (ADR-052 §9).
   *
   * UMA ROTA para as duas pecas, com a peca no caminho: o que muda entre
   * logo e icone e so a coluna gravada; duplicar a rota duplicaria as tres
   * travas de `BrandingService.substituir` (formato, antivirus, storage) e a
   * primeira que divergisse seria o buraco.
   *
   * O teto do interceptor e o MESMO do dominio, e nao um valor proprio:
   * numeros diferentes fariam o arquivo entre os dois ser recusado por
   * `PayloadTooLargeException` do Nest -- sem `code` estavel e sem a
   * mensagem que diz o limite.
   */
  @Post('tenants/:id/branding/:peca')
  @ApiCreatedResponse({ schema: ESQUEMA_DO_ARQUIVO_ENVIADO })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: TAMANHO_MAXIMO_DE_IDENTIDADE_BYTES } }),
  )
  async enviarArquivoDeMarca(
    @Param('id') id: string,
    @Param('peca') peca: string,
    @UploadedFile() arquivo: ArquivoRecebido | undefined,
  ): Promise<{ objectKey: string }> {
    if (peca !== 'logo' && peca !== 'icon') {
      throw new BadRequestException({ code: 'BRANDING_PIECE_INVALID' });
    }

    if (!arquivo) {
      throw new BadRequestException({ code: 'FILE_REQUIRED' });
    }

    return this.branding.substituir(id, peca, {
      contentType: arquivo.mimetype,
      conteudo: new Uint8Array(arquivo.buffer),
    });
  }

  @Patch('tenants/:id')
  @ApiOkResponse({ schema: ESQUEMA_DO_TENANT_ALTERADO })
  async alterar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ id: string }> {
    const { reason, ...dados } = esquemaDeAlteracaoDeTenant.parse(corpo);

    await this.alterarTenant.executar(
      this.contexto.require(),
      id,
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
      reason,
    );

    return { id };
  }

  /**
   * Entra no tenant como suporte. Devolve NOVO cookie de acesso, ja com o
   * tenant alvo -- a sessao e a mesma, o que muda e o alcance dela.
   */
  @Post('tenants/:id/elevar')
  @ApiCreatedResponse({ schema: ESQUEMA_DA_ELEVACAO })
  async abrirElevacao(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
    @Res({ passthrough: true }) resposta: Response,
  ): Promise<{ id: string; expiresAt: string }> {
    const { reason } = esquemaDeElevacao.parse(corpo);

    const resultado = await this.elevar.executar(
      this.contexto.require(),
      id,
      reason,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    resposta.cookie(COOKIE_DE_ACESSO, resultado.accessToken, {
      ...OPCOES_DE_COOKIE,
      maxAge: ACESSO_VALIDO_POR_MS,
    });

    return { id: resultado.elevacaoId, expiresAt: resultado.expiresAt.toISOString() };
  }

  /** Sai do tenant. O cookie volta a ser token de plataforma, sem tenant. */
  @Post('elevacao/encerrar')
  @ApiOkResponse({ schema: ESQUEMA_DA_SAIDA_DE_ELEVACAO })
  async fecharElevacao(
    @Req() requisicao: Request,
    @Res({ passthrough: true }) resposta: Response,
  ): Promise<{ encerrada: boolean }> {
    const resultado = await this.encerrarElevacao.executar(
      this.contexto.require(),
      requisicao.correlationId ?? 'sem-correlacao',
    );

    resposta.cookie(COOKIE_DE_ACESSO, resultado.accessToken, {
      ...OPCOES_DE_COOKIE,
      maxAge: ACESSO_VALIDO_POR_MS,
    });

    return { encerrada: true };
  }
}
