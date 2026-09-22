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
import { PrismaService } from '../../persistence/prisma.service.js';
import { COOKIE_DE_ACESSO } from '../auth/cookies.js';
import { AdminDoTenantUseCase } from './admin-do-tenant.use-case.js';
import { AlterarTenantUseCase, TenantNaoEncontradoError } from './alterar-tenant.use-case.js';
import { CriarTenantUseCase } from './criar-tenant.use-case.js';
import { avaliarCarencia } from './domain/carencia.js';
import { esquemaDeAlteracaoDeTenant } from './dto/alterar-tenant.dto.js';
import {
  esquemaDeConviteDeAdmin,
  esquemaDeRevogacaoDeConvite,
} from './dto/convite-de-admin.dto.js';
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

/**
 * Cobranca da lista do Super Admin -- F65, Task 10.
 *
 * `null` EXPLICITO quando nao ha fatura vencida (e nao campo ausente, como no
 * `/auth/me`): a lista tem formato de LINHA fixo, e uma linha com campo
 * ausente vira `undefined` em runtime e obriga o front a checar dois jeitos
 * de "sem cobranca".
 */
const ESQUEMA_DA_COBRANCA_NA_LISTA = {
  type: 'object',
  nullable: true,
  required: ['diasRestantes', 'emAbertoMinor'],
  properties: {
    diasRestantes: { type: 'integer', nullable: true },
    emAbertoMinor: { type: 'integer' },
  },
};

const ESQUEMA_DO_TENANT_NA_LISTA = {
  type: 'object',
  required: ['id', 'slug', 'displayName', 'status', 'unidades'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    slug: { type: 'string' },
    displayName: { type: 'string' },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
    unidades: { type: 'integer' },
    alunosAtivos: { type: 'integer' },
    alunosInativos: { type: 'integer' },
    cobranca: ESQUEMA_DA_COBRANCA_NA_LISTA,
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
    alunosAtivos: { type: 'integer' },
    alunosInativos: { type: 'integer' },
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

/**
 * Acesso do Admin do tenant -- F79.
 *
 * FORMA FIXA com `null` explicito, e nao campo ausente: `desde` so existe no
 * estado ATIVO e `expiraEm` so nos dois de convite, mas a linha e sempre a
 * mesma. Campo ausente vira `undefined` e obriga a tela a checar dois jeitos
 * de "nao tem" -- o motivo pelo qual `ESQUEMA_DA_COBRANCA_NA_LISTA` faz igual.
 */
const ESQUEMA_DO_ADMIN_DO_TENANT = {
  type: 'object',
  required: ['estado', 'email', 'desde', 'expiraEm'],
  properties: {
    estado: { type: 'string', enum: ['ATIVO', 'PENDENTE', 'VENCIDO', 'SEM_CONVITE'] },
    email: { type: 'string', nullable: true },
    desde: { type: 'string', format: 'date-time', nullable: true },
    expiraEm: { type: 'string', format: 'date-time', nullable: true },
  },
};

/**
 * `token` FICA no contrato, como em `ESQUEMA_DO_CONVITE` do `iam.controller`:
 * e a unica copia que existe (o banco guarda so o hash) e quem chama a rota ja
 * e Super Admin. Com o provedor de e-mail fora, e por ele que o acesso chega.
 */
const ESQUEMA_DO_CONVITE_DE_ADMIN = {
  type: 'object',
  required: ['email', 'expiresAt', 'token', 'emailEnviado'],
  properties: {
    email: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
    token: { type: 'string' },
    emailEnviado: { type: 'boolean' },
  },
};

const ESQUEMA_DA_REVOGACAO_DE_CONVITE = {
  type: 'object',
  required: ['revogado'],
  properties: { revogado: { type: 'boolean' } },
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
    private readonly adminDoTenant: AdminDoTenantUseCase,
    private readonly encerrarElevacao: EncerrarElevacaoUseCase,
    private readonly branding: BrandingService,
    private readonly db: PrismaService,
  ) {}

  @Get('tenants')
  @ApiOkResponse({ schema: { type: 'array', items: ESQUEMA_DO_TENANT_NA_LISTA } })
  async listar(): Promise<
    Array<{
      id: string;
      slug: string;
      displayName: string;
      status: string;
      unidades: number;
      alunosAtivos: number;
      alunosInativos: number;
      cobranca: { diasRestantes: number | null; emAbertoMinor: number } | null;
    }>
  > {
    /*
     * TRES consultas para N academias, e nao N+1: a lista, o `groupBy` de
     * ativos e a cobranca (ela mesma outra rodada de consultas agregadas, ver
     * `cobrancaPorTenant`) saem em paralelo.
     */
    const [encontrados, ativosPorTenant, cobrancaPorTenant] = await Promise.all([
      this.tenants.listar(),
      this.tenants.ativosPorTenant(),
      this.cobrancaPorTenant(),
    ]);

    // DTO explicito: `cnpj` e `responsavelEmail` ficam de fora da lista --
    // ela e visao de painel, nao dump da tabela.
    return encontrados.map((tenant) => {
      const ativos = ativosPorTenant.get(tenant.id) ?? 0;

      return {
        id: tenant.id,
        slug: tenant.slug,
        displayName: tenant.displayName,
        status: tenant.status,
        unidades: tenant._count.gymUnits,
        /*
         * A MESMA definicao da fatura (ADR-052 §6): ativo e `ACTIVE`, inativo
         * e TODO o resto. Por complemento, e nao enumerando os seis status --
         * a lista e a fatura tem de dar o mesmo numero, e duas definicoes
         * separadas divergem no dia em que um status novo entrar.
         */
        alunosAtivos: ativos,
        alunosInativos: tenant._count.students - ativos,
        cobranca: cobrancaPorTenant.get(tenant.id) ?? null,
      };
    });
  }

  /**
   * Cobranca de TODOS os tenants, numa rodada so -- F65, Task 10.
   *
   * MESMA logica do `AuthController.cobranca` (F65, Task 9), com a MESMA
   * chamada a `avaliarCarencia`: a diferenca e que aqui e para a lista
   * inteira, entao as consultas sao agregadas por tenant em vez de uma por
   * chamada.
   *
   * QUATRO consultas de tamanho fixo, nunca uma por tenant:
   * 1. faturas OVERDUE de TODOS os tenants, agrupadas por tenantId;
   * 2. contratos ATIVOS de todos os tenants (fornece `graceDays`);
   * 3. timezone dos tenants candidatos (os que tem fatura vencida E
   *    contrato) -- so estes podem aparecer no resultado;
   * 4. timezone de fallback (primeira `GymUnit`) SO para os candidatos cujo
   *    `Tenant.timezone` e nulo -- e o mesmo fallback Tenant->GymUnit do job
   *    (`SuspenderTenantUseCase.executarCiclo`) e do `/auth/me`.
   *
   * Tenant sem fatura vencida ou sem contrato ativo nao entra no mapa -- o
   * controller le isso como `cobranca: null`.
   */
  private async cobrancaPorTenant(): Promise<
    Map<string, { diasRestantes: number | null; emAbertoMinor: number }>
  > {
    const [faturasVencidas, contratosAtivos] = await Promise.all([
      this.db.platformInvoice.findMany({
        where: { status: 'OVERDUE' },
        select: { tenantId: true, dueAt: true, totalMinor: true },
      }),
      this.db.tenantContract.findMany({
        where: { status: 'ACTIVE' },
        select: { tenantId: true, graceDays: true },
      }),
    ]);

    const faturasPorTenant = new Map<string, Array<{ dueAt: Date; totalMinor: number }>>();
    for (const fatura of faturasVencidas) {
      const lista = faturasPorTenant.get(fatura.tenantId) ?? [];
      lista.push({ dueAt: fatura.dueAt, totalMinor: fatura.totalMinor });
      faturasPorTenant.set(fatura.tenantId, lista);
    }

    const graceDaysPorTenant = new Map(contratosAtivos.map((c) => [c.tenantId, c.graceDays]));

    // So os candidatos: tenant com fatura vencida E contrato ativo. Os dois
    // faltando ja decidem `cobranca: null` sem gastar consulta de timezone.
    const idsCandidatos = [...faturasPorTenant.keys()].filter((id) => graceDaysPorTenant.has(id));

    if (idsCandidatos.length === 0) return new Map();

    const tenantsCandidatos = await this.db.tenant.findMany({
      where: { id: { in: idsCandidatos } },
      select: { id: true, timezone: true },
    });

    const idsSemTimezoneProprio = tenantsCandidatos
      .filter((t) => !t.timezone)
      .map((t) => t.id);

    /*
     * Fallback Tenant->GymUnit -- MESMO fallback do `/auth/me`: primeira
     * unidade por `createdAt`. `distinct` no lugar de `groupBy` porque o dado
     * buscado (`timezone`) nao e agregavel -- so a linha mais antiga importa.
     */
    const timezonesDeFallback =
      idsSemTimezoneProprio.length === 0
        ? []
        : await this.db.gymUnit.findMany({
            where: { tenantId: { in: idsSemTimezoneProprio } },
            select: { tenantId: true, timezone: true },
            distinct: ['tenantId'],
            orderBy: { createdAt: 'asc' },
          });

    const timezoneDeFallbackPorTenant = new Map(
      timezonesDeFallback.map((g) => [g.tenantId, g.timezone]),
    );

    const resultado = new Map<string, { diasRestantes: number | null; emAbertoMinor: number }>();

    for (const tenant of tenantsCandidatos) {
      const timezone = tenant.timezone ?? timezoneDeFallbackPorTenant.get(tenant.id);

      // Sem timezone nao ha como avaliar as 6h locais -- mesmo caminho do
      // job e do `/auth/me`. Tenant fica fora do mapa: `cobranca: null`.
      if (!timezone) continue;

      const graceDays = graceDaysPorTenant.get(tenant.id);
      if (graceDays === undefined) continue;

      const situacao = avaliarCarencia({
        faturasVencidas: faturasPorTenant.get(tenant.id) ?? [],
        graceDays,
        agora: new Date(),
        timezone,
      });

      resultado.set(tenant.id, {
        diasRestantes: situacao.diasRestantes,
        emAbertoMinor: situacao.emAbertoMinor,
      });
    }

    return resultado;
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

  /**
   * O acesso do Admin desta academia -- F79.
   *
   * Responde a pergunta que a aba "Acesso" faz: o Admin consegue entrar? Os
   * quatro estados saem de `Invitation` cruzada com `UserRole`.
   */
  @Get('tenants/:id/admin')
  @ApiOkResponse({ schema: ESQUEMA_DO_ADMIN_DO_TENANT })
  async consultarAdmin(@Param('id') id: string): Promise<{
    estado: string;
    email: string | null;
    desde: string | null;
    expiraEm: string | null;
  }> {
    const estado = await this.adminDoTenant.consultar(id);

    /*
     * ACHATA a uniao discriminada num objeto de forma FIXA, com `null` onde
     * o campo nao se aplica.
     *
     * Campo ausente vira `undefined` em runtime e obriga a tela a checar dois
     * jeitos de "nao tem" -- a mesma razao que `ESQUEMA_DA_COBRANCA_NA_LISTA`
     * declara `null` explicito.
     */
    return {
      estado: estado.estado,
      email: estado.email,
      desde: estado.estado === 'ATIVO' ? estado.desde.toISOString() : null,
      expiraEm:
        estado.estado === 'PENDENTE'
          ? estado.expiraEm.toISOString()
          : estado.estado === 'VENCIDO'
            ? estado.expirouEm.toISOString()
            : null,
    };
  }

  /**
   * Cria, reenvia ou corrige o convite do Admin -- F79.
   *
   * Uma rota para os tres atos porque os tres terminam no mesmo estado: UM
   * convite pendente valido.
   */
  @Post('tenants/:id/admin/convite')
  @ApiCreatedResponse({ schema: ESQUEMA_DO_CONVITE_DE_ADMIN })
  async convidarAdmin(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ email: string; expiresAt: string; token: string; emailEnviado: boolean }> {
    const { email } = esquemaDeConviteDeAdmin.parse(corpo);

    const resultado = await this.adminDoTenant.convidar(
      this.contexto.require(),
      id,
      email,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    /*
     * FORA DA TRANSACAO, como `criar` e o `iam.controller` ja fazem: provedor
     * de e-mail que recusa nao pode desfazer o convite ja gravado. O link
     * vale, e `emailEnviado` deixa a tela dizer a verdade a quem convidou --
     * silencio aqui faria alguem esperar por um e-mail que nao saiu.
     */
    const envio = await this.emails.enviar(resultado.email, resultado.token);

    // O token aparece UMA VEZ: o banco guarda so o SHA-256. Quem chama a rota
    // ja e Super Admin, entao entregar o link a mao e caminho legitimo quando
    // o e-mail nao sai.
    return {
      email: resultado.email,
      expiresAt: resultado.expiresAt.toISOString(),
      token: resultado.token,
      emailEnviado: envio.enviado,
    };
  }

  /**
   * Revoga o convite pendente do Admin. O link para de valer na hora.
   *
   * MOTIVO OBRIGATORIO: o ato tira o acesso de alguem e nao se desfaz. A
   * justificativa vai para a auditoria dos dois lados, como no desligamento de
   * cliente.
   */
  @Post('tenants/:id/admin/convite/revogar')
  @ApiOkResponse({ schema: ESQUEMA_DA_REVOGACAO_DE_CONVITE })
  async revogarConviteDeAdmin(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ revogado: boolean }> {
    const { reason } = esquemaDeRevogacaoDeConvite.parse(corpo);

    await this.adminDoTenant.revogar(
      this.contexto.require(),
      id,
      reason,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return { revogado: true };
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
