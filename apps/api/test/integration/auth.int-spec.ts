import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Cobre o que da para errar em silencio na autenticacao.
 *
 * Cada teste aqui corresponde a uma forma conhecida de perder sessao de
 * usuario: resposta que distingue e-mail inexistente de senha errada, token
 * que sobrevive ao logout, refresh roubado que continua valendo.
 */
describe('autenticacao', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;

  const sufixo = randomUUID().slice(0, 8);
  const EMAIL = `dono-${sufixo}@exemplo.test`;
  const SENHA = 'senha-de-teste-correta';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  /** Extrai um cookie especifico do `set-cookie` da resposta. */
  const pegarCookie = (resposta: request.Response, nome: string): string | undefined => {
    // `headers` e indexado como `any` no supertest; estreitar aqui evita
    // espalhar `no-unsafe-member-access` por cada uso.
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho)
      ? (cabecalho as string[])
      : typeof cabecalho === 'string'
        ? [cabecalho]
        : [];

    return lista.find((c) => c.startsWith(`${nome}=`));
  };

  const valorDoCookie = (cookie: string): string => cookie.split(';')[0]?.split('=')[1] ?? '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: {
        slug: `auth-${sufixo}`,
        legalName: 'Academia Auth LTDA',
        displayName: 'Academia Auth',
      },
    });

    const user = await db.user.create({
      data: { email: EMAIL, passwordHash: await senhas.gerarHash(SENHA) },
    });

    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id } });
  });

  afterAll(async () => {
    await app?.close();
  });

  const logar = async (): Promise<request.Response> =>
    request(servidor()).post('/api/v1/auth/login').send({ email: EMAIL, password: SENHA });

  describe('POST /api/v1/auth/login', () => {
    it('autentica e entrega os cookies de sessao', async () => {
      const resposta = await logar();

      expect(resposta.status).toBe(200);

      const acesso = pegarCookie(resposta, 'arenahub_access');
      const refresh = pegarCookie(resposta, 'arenahub_refresh');

      expect(acesso).toBeDefined();
      expect(refresh).toBeDefined();

      // HttpOnly impede que script de pagina leia a credencial -- e a
      // diferenca entre um XSS que rouba a sessao e um que nao rouba.
      expect(acesso).toMatch(/HttpOnly/i);
      expect(refresh).toMatch(/HttpOnly/i);
      // SameSite fecha o caminho mais barato de CSRF.
      expect(acesso).toMatch(/SameSite=Strict/i);
    });

    it('nunca devolve token no corpo da resposta', async () => {
      const resposta = await logar();
      const corpo = JSON.stringify(resposta.body);

      // Token no JSON acaba em `localStorage`, e `localStorage` e legivel
      // por qualquer script da pagina.
      expect(corpo).not.toMatch(/eyJ/);
      expect(corpo).not.toMatch(/token/i);
    });

    it('responde igual para senha errada e para e-mail inexistente', async () => {
      const senhaErrada = await request(servidor())
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: 'senha-errada' });

      const emailInexistente = await request(servidor())
        .post('/api/v1/auth/login')
        .send({ email: `fantasma-${sufixo}@exemplo.test`, password: SENHA });

      // Resposta diferente transforma o login num oraculo de quem tem conta
      // -- util para phishing dirigido e para credential stuffing.
      //
      // `correlationId` e unico por requisicao de proposito, entao a
      // comparacao exclui ele e cobre o resto: status, codigo e titulo.
      expect(senhaErrada.status).toBe(401);
      expect(emailInexistente.status).toBe(401);

      const semCorrelacao = (corpo: unknown): unknown => {
        const { correlationId: _ignorado, ...resto } = corpo as Record<string, unknown>;
        return resto;
      };

      expect(semCorrelacao(senhaErrada.body)).toEqual(semCorrelacao(emailInexistente.body));
    });

    it('devolve problem+json com codigo estavel e correlationId', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: 'senha-errada' });

      expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(resposta.body).toMatchObject({
        type: expect.any(String),
        title: expect.any(String),
        status: 401,
        code: 'AUTH_INVALID_CREDENTIALS',
        correlationId: expect.any(String),
      });
    });

    it('recusa corpo com campo desconhecido', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: SENHA, tenantId: 'tenant-escolhido-pelo-cliente' });

      // Regra de arquitetura no 2: o tenant vem da identidade autenticada,
      // nunca do corpo da requisicao. Aceitar campo desconhecido e como o
      // cliente comeca a sugerir coisas.
      expect(resposta.status).toBe(400);
    });

    it('recusa e-mail malformado', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/auth/login')
        .send({ email: 'nao-e-email', password: SENHA });

      expect(resposta.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    let refreshInicial: string;

    beforeEach(async () => {
      const login = await logar();
      refreshInicial = pegarCookie(login, 'arenahub_refresh') ?? '';
    });

    it('rotaciona o refresh e entrega um novo par', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshInicial);

      expect(resposta.status).toBe(200);

      const novoRefresh = pegarCookie(resposta, 'arenahub_refresh');

      expect(novoRefresh).toBeDefined();
      expect(valorDoCookie(novoRefresh ?? '')).not.toBe(valorDoCookie(refreshInicial));
    });

    it('recusa o refresh antigo depois da rotacao', async () => {
      await request(servidor()).post('/api/v1/auth/refresh').set('Cookie', refreshInicial);

      const reuso = await request(servidor())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshInicial);

      expect(reuso.status).toBe(401);
      expect(reuso.body).toMatchObject({ code: 'AUTH_REFRESH_REUSED' });
    });

    it('revoga a familia inteira quando detecta reuso', async () => {
      const rotacionado = await request(servidor())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshInicial);
      const refreshValido = pegarCookie(rotacionado, 'arenahub_refresh') ?? '';

      // Token antigo reaparecendo significa que alguem o copiou. Nao da
      // para saber se quem esta usando o token novo e a vitima ou o
      // ladrao -- entao a cadeia inteira cai, e os dois refazem o login.
      await request(servidor()).post('/api/v1/auth/refresh').set('Cookie', refreshInicial);

      const depoisDaRevogacao = await request(servidor())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshValido);

      expect(depoisDaRevogacao.status).toBe(401);
    });

    it('recusa requisicao sem cookie de refresh', async () => {
      const resposta = await request(servidor()).post('/api/v1/auth/refresh');

      expect(resposta.status).toBe(401);
    });

    it('recusa refresh inexistente sem revelar o motivo', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'arenahub_refresh=token-que-nunca-existiu');

      expect(resposta.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revoga a sessao e limpa os cookies', async () => {
      const login = await logar();
      const refresh = pegarCookie(login, 'arenahub_refresh') ?? '';

      const logout = await request(servidor()).post('/api/v1/auth/logout').set('Cookie', refresh);

      expect(logout.status).toBe(204);

      const depois = await request(servidor())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refresh);

      // Logout que nao invalida o refresh no servidor e so uma limpeza de
      // cookie: quem tiver copiado o token continua entrando.
      expect(depois.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('identifica quem esta autenticado', async () => {
      const login = await logar();
      const acesso = pegarCookie(login, 'arenahub_access') ?? '';

      const resposta = await request(servidor()).get('/api/v1/auth/me').set('Cookie', acesso);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({ email: EMAIL });
    });

    it('nunca devolve o hash da senha', async () => {
      const login = await logar();
      const acesso = pegarCookie(login, 'arenahub_access') ?? '';

      const resposta = await request(servidor()).get('/api/v1/auth/me').set('Cookie', acesso);
      const corpo = JSON.stringify(resposta.body);

      expect(corpo).not.toMatch(/scrypt/);
      expect(corpo).not.toMatch(/passwordHash/i);
    });

    it('recusa sem credencial', async () => {
      const resposta = await request(servidor()).get('/api/v1/auth/me');

      expect(resposta.status).toBe(401);
    });
  });
});
