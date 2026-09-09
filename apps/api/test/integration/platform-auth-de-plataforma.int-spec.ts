import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Prova o ramo de PLATAFORMA do `AuthGuard`: token sem `tenantId` monta
 * `PlatformContext` lendo `PlatformAdmin` ativo do banco, e rota marcada com
 * `@PlatformRoute()` recusa usuario de tenant com 403.
 *
 * A sessao de plataforma e montada aqui a mao (usuario + Session sem tenant +
 * token emitido pelo `TokenService`) porque `/api/v1/auth/login` ainda resolve
 * um vinculo de tenant obrigatorio -- o login de plataforma nasce na Task 6.
 */
describe('autenticacao de plataforma', () => {
  let app: INestApplication;
  let db: PrismaService;
  let tokens: TokenService;
  let senhas: PasswordService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  let cookieDeTenant = '';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  /** Usuario + Session SEM tenant + token de plataforma, tudo pronto para usar. */
  const criarSuperAdmin = async (): Promise<{ cookie: string; userId: string }> => {
    const usuario = await db.user.create({
      data: {
        email: `super-${randomUUID().slice(0, 8)}@exemplo.test`,
        // Hash de verdade: a suite `vazamento` varre a tabela inteira e
        // recusa qualquer segredo em claro, inclusive de fixture.
        passwordHash: await senhas.gerarHash(SENHA),
      },
    });

    await db.platformAdmin.create({ data: { userId: usuario.id } });

    const sessao = await db.session.create({
      data: {
        userId: usuario.id,
        tenantId: null,
        tokenHash: randomUUID(),
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const token = tokens.emitirAcesso({
      sub: usuario.id,
      tenantId: null,
      sessionId: sessao.id,
      permissions: [],
      mfa: true,
    });

    return { cookie: `arenahub_access=${token}`, userId: usuario.id };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    tokens = app.get(TokenService);

    senhas = app.get(PasswordService);

    const email = `dono-plat-${sufixo}@exemplo.test`;

    const tenant = await db.tenant.create({
      data: { slug: `plat-${sufixo}`, legalName: 'Plat LTDA', displayName: 'Plat' },
    });

    const usuario = await db.user.create({
      data: { email, passwordHash: await senhas.gerarHash(SENHA) },
    });

    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: usuario.id } });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email, password: SENHA });

    cookieDeTenant = cookieDeAcesso(login);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('usuario de tenant recebe 403 problem+json em rota de plataforma', async () => {
    const resposta = await request(servidor())
      .get('/api/v1/platform/tenants')
      .set('Cookie', cookieDeTenant);

    expect(resposta.status).toBe(403);
    expect(resposta.headers['content-type']).toContain('application/problem+json');
    expect((resposta.body as { code?: string }).code).toBe('FORBIDDEN');
  });

  it('Super Admin com sessao sem tenant alcanca rota de plataforma', async () => {
    const { cookie } = await criarSuperAdmin();

    const resposta = await request(servidor())
      .get('/api/v1/platform/tenants')
      .set('Cookie', cookie);

    expect(resposta.status).toBe(200);
  });

  it('Super Admin revogado nao alcanca rota de plataforma', async () => {
    const { cookie, userId } = await criarSuperAdmin();

    await db.platformAdmin.update({ where: { userId }, data: { revokedAt: new Date() } });

    const resposta = await request(servidor())
      .get('/api/v1/platform/tenants')
      .set('Cookie', cookie);

    expect(resposta.status).toBe(401);
  });
});
