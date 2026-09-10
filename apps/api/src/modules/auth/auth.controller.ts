import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { COOKIE_DE_ACESSO, COOKIE_DE_REFRESH, lerCookie } from './cookies.js';
import {
  AuthService,
  ehDesafioDeMfa,
  type DesafioDeMfa,
  type ParDeTokens,
} from './auth.service.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { avaliarCarencia } from '../platform/domain/carencia.js';
import { TokenService } from './token.service.js';

const ACESSO_VALIDO_POR_MS = 10 * 60 * 1000;
const REFRESH_VALIDO_POR_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * `strict()` recusa campo desconhecido em vez de ignora-lo.
 *
 * Nao e purismo: e a regra de arquitetura no 2. Se um `tenantId` no corpo
 * passasse despercebido hoje, algum codigo futuro poderia comecar a le-lo --
 * e o tenant passaria a vir do cliente, que e exatamente o que a regra
 * proibe.
 */
const esquemaDeLogin = z
  .object({
    email: z.string().email().max(320),
    password: z.string().min(1).max(1024),
  })
  .strict();

/** Seis digitos: o TOTP do `TotpService`. */
const esquemaDeVerificacaoDeMfa = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

/** O que a inscricao devolve -- ver `mfa/enroll`. */
interface InscricaoDeMfa {
  /** URI `otpauth://` -- o celular a entrega ao autenticador. */
  uri: string;
  /** O mesmo segredo em base32, para quem digita a mao. */
  base32: string;
}

/*
 * Schema declarado a mao: o Nest so infere de CLASSE decorada, e o painel
 * consome `interface`. A guarda de contrato (`openapi.int-spec.ts`) reprova
 * rota nova sem `@ApiOkResponse`.
 */
const ESQUEMA_DA_INSCRICAO = {
  type: 'object',
  properties: { uri: { type: 'string' }, base32: { type: 'string' } },
  required: ['uri', 'base32'],
};

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly contexto: TenantContextService,
    private readonly db: PrismaService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
    @Res({ passthrough: true }) resposta: Response,
  ): Promise<DesafioDeMfa | Record<string, never>> {
    // `unknown` antes de validar (`CLAUDE.md`, Convencoes). O DTO tipado
    // so existe depois que o Zod confirmou a forma.
    const dados = esquemaDeLogin.parse(corpo);

    const resultado = await this.auth.login(
      dados.email,
      dados.password,
      requisicao.ip ?? 'sem-ip',
    );

    /*
     * O DESAFIO NAO GRAVA COOKIE (INV-007).
     *
     * O pre-auth vai no corpo justamente porque nao e credencial de sessao:
     * ele so serve para completar o segundo fator, e nao alcanca rota
     * nenhuma. Guarda-lo no mesmo cookie do access token o faria parecer
     * sessao para o resto do sistema.
     */
    if (ehDesafioDeMfa(resultado)) return resultado;

    this.gravarCookies(resposta, resultado);

    // Corpo vazio de proposito: token vive em cookie HttpOnly. Devolve-lo
    // no JSON o levaria para `localStorage`, legivel por qualquer script.
    return {};
  }

  /**
   * Segundo fator do Super Admin: troca o pre-auth pela sessao definitiva.
   *
   * `@Public()` porque ainda nao ha sessao -- a credencial que autoriza esta
   * chamada e o proprio pre-auth, no cabecalho `Authorization`.
   */
  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: {} } })
  async verificarMfa(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
    @Res({ passthrough: true }) resposta: Response,
  ): Promise<Record<string, never>> {
    const dados = esquemaDeVerificacaoDeMfa.parse(corpo);

    this.gravarCookies(
      resposta,
      await this.auth.verificarMfa(this.lerPreAuth(requisicao), dados.code),
    );

    return {};
  }

  /**
   * Inscricao no TOTP para o Super Admin que ainda nao tem segundo fator.
   *
   * `@Public()` pelo mesmo motivo de `mfa/verify`: nao ha sessao ainda, e a
   * credencial que autoriza e o pre-auth no `Authorization`.
   *
   * ESTA ROTA EXISTE PORQUE AS DE `iam.controller.ts` NAO SERVEM AO SUPER
   * ADMIN (issue #293): elas chamam `TenantContextService.require()`, que
   * lanca para quem nao esta em tenant nenhum. Sem ela, o Super Admin que
   * cai em `MFA_SETUP` nao tem caminho -- so o seed.
   *
   * O segredo sai no corpo de propósito: e a unica vez que ele pode ser
   * lido, e e o que a pessoa copia para o autenticador. Ele NAO vira sessao
   * -- `mfaStatus` fica `PENDING` ate a confirmacao.
   */
  @Public()
  @Post('mfa/enroll')
  @HttpCode(200)
  @ApiOkResponse({ schema: ESQUEMA_DA_INSCRICAO })
  async iniciarInscricaoDeMfa(@Req() requisicao: Request): Promise<InscricaoDeMfa> {
    return this.auth.iniciarInscricaoDeMfa(this.lerPreAuth(requisicao));
  }

  /**
   * Confirma a inscricao com o primeiro codigo e ja abre a sessao.
   *
   * Devolver sessao aqui nao afrouxa o INV-007: a pessoa apresentou a senha
   * (no login, que emitiu o pre-auth) e um codigo TOTP que o servidor
   * conferiu contra o segredo recem-gravado. Sao os dois fatores.
   */
  @Public()
  @Post('mfa/enroll/confirm')
  @HttpCode(200)
  @ApiOkResponse({ schema: { type: 'object', properties: {} } })
  async confirmarInscricaoDeMfa(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
    @Res({ passthrough: true }) resposta: Response,
  ): Promise<Record<string, never>> {
    const dados = esquemaDeVerificacaoDeMfa.parse(corpo);

    this.gravarCookies(
      resposta,
      await this.auth.confirmarInscricaoDeMfa(this.lerPreAuth(requisicao), dados.code),
    );

    return {};
  }

  /**
   * Le o pre-auth do `Authorization`. Sem ele, `NaoAutenticadoError`.
   *
   * Extraido porque sao TRES rotas lendo o mesmo cabecalho da mesma forma --
   * e um `startsWith` esquecido faria `slice(7)` cortar sete caracteres de um
   * cabecalho que nao e Bearer, produzindo um token quebrado em vez de um
   * 401 claro.
   */
  private lerPreAuth(requisicao: Request): string {
    const cabecalho = requisicao.headers.authorization ?? '';

    if (!cabecalho.startsWith('Bearer ')) throw new NaoAutenticadoError();

    return cabecalho.slice(7);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() requisicao: Request, @Res({ passthrough: true }) resposta: Response) {
    const token = lerCookie(requisicao.headers.cookie, COOKIE_DE_REFRESH);

    if (!token) throw new NaoAutenticadoError();

    this.gravarCookies(resposta, await this.auth.refresh(token));

    return {};
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() requisicao: Request, @Res({ passthrough: true }) resposta: Response) {
    await this.auth.logout(lerCookie(requisicao.headers.cookie, COOKIE_DE_REFRESH));

    resposta.clearCookie(COOKIE_DE_ACESSO, this.opcoesDeCookie());
    resposta.clearCookie(COOKIE_DE_REFRESH, this.opcoesDeCookie());
  }

  @Get('me')
  async me(@Req() requisicao: Request) {
    const token = lerCookie(requisicao.headers.cookie, COOKIE_DE_ACESSO);

    if (!token) throw new NaoAutenticadoError();

    try {
      const claims = this.tokens.verificarAcesso(token);

      /**
       * AS PERMISSOES VAO JUNTO -- F54.
       *
       * O painel precisa esconder do menu o que a pessoa nao alcanca
       * (`SPEC-054` §7), e ate aqui o front nao tinha como saber quem pode o
       * que: escondia nada, e cada tela descobria a recusa ao abrir.
       *
       * NAO E CONTROLE DE ACESSO, e a distincao importa: quem digitar a URL
       * chega igual, e quem barra continua sendo o `PermissionsGuard` no
       * servidor. Esconder o item so evita oferecer a alguem uma tela que vai
       * recusa-lo -- e o guard segue sendo a unica coisa entre a pessoa e o
       * dado.
       *
       * SEM CONSULTA NOVA: o `AuthGuard` ja montou este conjunto a partir do
       * BANCO para esta requisicao (nao do token, justamente para revogacao
       * valer na hora). Aqui so se le o que ja esta em memoria.
       */
      const contexto = this.contexto.opcional();

      return {
        ...(await this.auth.perfil(claims.sub)),
        permissions: contexto ? [...contexto.permissions].sort() : [],
        /*
         * A FAIXA DE SUPORTE do painel depende disto.
         *
         * Quem opera elevado ve a tela do cliente identica a sua propria; sem
         * o aviso, age achando que esta na propria casa. O nome do tenant vai
         * junto porque faixa que exibe um UUID nao avisa ninguem -- e e a
         * unica consulta nova aqui, ja que o resto o `AuthGuard` deixou em
         * memoria.
         */
        ...(contexto?.supportElevation
          ? {
              supportElevation: {
                reason: contexto.supportElevation.reason,
                expiraEm: contexto.supportElevation.expiresAt.toISOString(),
                tenant: await this.auth.nomeDoTenant(contexto.tenantId),
              },
            }
          : {}),
        /*
         * A FAIXA DE COBRANCA do painel depende disto -- F65, Task 9.
         *
         * So aparece quando ha fatura vencida: mesmo padrao condicional do
         * `supportElevation`, um bloco ausente nao renderiza aviso nenhum.
         */
        ...((await this.cobranca(contexto?.tenantId)) ?? {}),
      };
    } catch {
      // Token invalido, expirado ou de outro tipo produzem a mesma
      // resposta: quem esta sondando nao aprende qual dos tres foi.
      throw new NaoAutenticadoError();
    }
  }

  /**
   * Situacao de cobranca do tenant, para a faixa do painel -- F65, Task 9.
   *
   * `undefined` sem `tenantId` (sessao de plataforma) e sem fatura vencida
   * nenhuma -- mesmo padrao do `supportElevation`: bloco ausente, sem aviso.
   *
   * O timezone segue o MESMO fallback Tenant->GymUnit de
   * `SuspenderTenantUseCase.executarCiclo`: sem um dos dois nao ha como
   * avaliar as 6h locais que decidem a suspensao.
   */
  private async cobranca(
    tenantId: string | undefined,
  ): Promise<{ cobranca: { diasRestantes: number; emAbertoMinor: number; suspensa: boolean } } | undefined> {
    if (!tenantId) return undefined;

    const tenant = await this.db.tenant.findUnique({
      where: { id: tenantId },
      select: {
        status: true,
        timezone: true,
        gymUnits: { take: 1, orderBy: { createdAt: 'asc' }, select: { timezone: true } },
      },
    });

    if (!tenant) return undefined;

    const contrato = await this.db.tenantContract.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      select: { graceDays: true },
    });

    // Sem contrato vigente nao ha `graceDays` para avaliar -- mesmo caminho
    // do job (`SuspenderTenantUseCase`).
    if (!contrato) return undefined;

    const faturasVencidas = await this.db.platformInvoice.findMany({
      where: { tenantId, status: 'OVERDUE' },
      select: { dueAt: true, totalMinor: true },
    });

    if (faturasVencidas.length === 0) return undefined;

    const timezone = tenant.timezone ?? tenant.gymUnits[0]?.timezone;

    // Sem timezone nao ha como avaliar as 6h locais -- mesmo caminho do job.
    if (!timezone) return undefined;

    const situacao = avaliarCarencia({
      faturasVencidas,
      graceDays: contrato.graceDays,
      agora: new Date(),
      timezone,
    });

    // `diasRestantes` so e `null` quando nao ha fatura vencida, e ja
    // recusamos esse caso acima -- a checagem documenta a garantia.
    if (situacao.diasRestantes === null) return undefined;

    return {
      cobranca: {
        diasRestantes: situacao.diasRestantes,
        emAbertoMinor: situacao.emAbertoMinor,
        suspensa: tenant.status === 'SUSPENDED',
      },
    };
  }

  private gravarCookies(resposta: Response, par: ParDeTokens): void {
    resposta.cookie(COOKIE_DE_ACESSO, par.accessToken, {
      ...this.opcoesDeCookie(),
      maxAge: ACESSO_VALIDO_POR_MS,
    });
    resposta.cookie(COOKIE_DE_REFRESH, par.refreshToken, {
      ...this.opcoesDeCookie(),
      maxAge: REFRESH_VALIDO_POR_MS,
    });
  }

  private opcoesDeCookie() {
    return {
      // HttpOnly: script de pagina nao le. E a diferenca entre um XSS que
      // rouba a sessao e um que nao rouba.
      httpOnly: true,
      // Strict: o navegador nao manda o cookie em requisicao vinda de outro
      // site, o que fecha o caminho mais barato de CSRF.
      sameSite: 'strict' as const,
      // Fora de desenvolvimento, so por HTTPS.
      secure: process.env['NODE_ENV'] === 'production',
      path: '/',
    };
  }

}
