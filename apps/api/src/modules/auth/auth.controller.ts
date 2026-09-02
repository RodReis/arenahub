import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { COOKIE_DE_ACESSO, COOKIE_DE_REFRESH, lerCookie } from './cookies.js';
import { AuthService, type ParDeTokens } from './auth.service.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
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

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly contexto: TenantContextService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
    @Res({ passthrough: true }) resposta: Response,
  ) {
    // `unknown` antes de validar (`CLAUDE.md`, Convencoes). O DTO tipado
    // so existe depois que o Zod confirmou a forma.
    const dados = esquemaDeLogin.parse(corpo);

    this.gravarCookies(
      resposta,
      await this.auth.login(dados.email, dados.password, requisicao.ip ?? 'sem-ip'),
    );

    // Corpo vazio de proposito: token vive em cookie HttpOnly. Devolve-lo
    // no JSON o levaria para `localStorage`, legivel por qualquer script.
    return {};
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
      };
    } catch {
      // Token invalido, expirado ou de outro tipo produzem a mesma
      // resposta: quem esta sondando nao aprende qual dos tres foi.
      throw new NaoAutenticadoError();
    }
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
