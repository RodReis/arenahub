import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { CIFRADOR_DE_MFA } from '../../src/modules/auth/mfa.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import type { CifradorDeSegredo } from '../../src/modules/auth/segredo-cifrado.js';
import { TotpService } from '../../src/modules/auth/totp.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * INV-007: o dono do SaaS nao entra com um fator so.
 *
 * O caso do usuario COMUM e o que protege a base existente: OWNER, MANAGER,
 * RECEPTIONIST e TECH_OPERATOR continuam entrando como hoje. Ligar MFA para
 * eles seria migracao de base inteira, e nao e desta fatia.
 */
describe('MFA do Super Admin', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;
  let totp: TotpService;
  let cifrador: CifradorDeSegredo;

  const SENHA = 'senha-de-teste-correta';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookiesDe = (resposta: request.Response): string[] => {
    const cabecalho: unknown = resposta.headers['set-cookie'];

    return Array.isArray(cabecalho) ? (cabecalho as string[]) : [];
  };

  /**
   * Super Admin com MFA ja ativo. O segredo e cifrado aqui pelo MESMO
   * cifrador da aplicacao, para o teste conseguir gerar o TOTP depois.
   */
  const criarSuperAdminComMfa = async (): Promise<{ email: string; segredo: Buffer }> => {
    const email = `super-mfa-${randomUUID().slice(0, 8)}@exemplo.test`;
    const segredo = totp.gerarSegredo();
    const cifrado = cifrador.cifrar(segredo.bytes);

    const usuario = await db.user.create({
      data: {
        email,
        // Hash de verdade: a suite `vazamento` varre a tabela inteira.
        passwordHash: await senhas.gerarHash(SENHA),
        mfaStatus: 'ENABLED',
        mfaSecretCiphertext: new Uint8Array(cifrado.ciphertext),
        mfaSecretIv: new Uint8Array(cifrado.iv),
        mfaSecretTag: new Uint8Array(cifrado.tag),
      },
    });

    await db.platformAdmin.create({ data: { userId: usuario.id } });

    return { email, segredo: segredo.bytes };
  };

  /** Usuario de tenant como qualquer outro hoje: vinculo ativo, sem MFA. */
  const criarOwnerDeTenant = async (): Promise<string> => {
    const sufixo = randomUUID().slice(0, 8);
    const email = `dono-mfa-${sufixo}@exemplo.test`;

    const tenant = await db.tenant.create({
      data: { slug: `mfa-${sufixo}`, legalName: 'MFA LTDA', displayName: 'MFA' },
    });

    const usuario = await db.user.create({
      data: { email, passwordHash: await senhas.gerarHash(SENHA) },
    });

    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: usuario.id } });

    return email;
  };

  const logar = async (email: string): Promise<request.Response> =>
    request(servidor()).post('/api/v1/auth/login').send({ email, password: SENHA });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);
    totp = app.get(TotpService);
    cifrador = app.get<CifradorDeSegredo>(CIFRADOR_DE_MFA);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('login de Super Admin NAO devolve sessao completa, e sim desafio', async () => {
    const { email } = await criarSuperAdminComMfa();

    const resposta = await logar(email);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ desafio: 'MFA_VERIFY', preAuth: expect.any(String) });
    // Sem cookie de acesso: um fator so nao abre sessao de plataforma.
    expect(cookiesDe(resposta)).not.toContainEqual(
      expect.stringContaining('arenahub_access='),
    );
  });

  it('login de usuario COMUM segue devolvendo sessao, sem mudar de comportamento', async () => {
    const email = await criarOwnerDeTenant();

    const resposta = await logar(email);

    expect(resposta.status).toBe(200);
    expect(cookiesDe(resposta)).toContainEqual(expect.stringContaining('arenahub_access='));
  });

  it('codigo TOTP correto troca o pre-auth por sessao de plataforma', async () => {
    const { email, segredo } = await criarSuperAdminComMfa();
    const login = await logar(email);
    const preAuth = (login.body as { preAuth: string }).preAuth;

    const resposta = await request(servidor())
      .post('/api/v1/auth/mfa/verify')
      .set('Authorization', `Bearer ${preAuth}`)
      .send({ code: totp.gerarCodigo(segredo, Math.floor(Date.now() / 1000)) });

    expect(resposta.status).toBe(200);
    expect(cookiesDe(resposta)).toContainEqual(expect.stringContaining('arenahub_access='));

    // A sessao de plataforma nasce SEM tenant -- e o que o `AuthGuard` le
    // para montar `PlatformContext` em vez de `TenantContext`.
    const sessao = await db.session.findFirstOrThrow({
      where: { user: { email } },
      orderBy: { createdAt: 'desc' },
    });
    expect(sessao.tenantId).toBeNull();
  });
});
