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

  /**
   * Super Admin que ainda NAO tem segundo fator -- o caso da issue #293.
   * `mfaStatus` nasce no padrao do schema, sem segredo gravado.
   */
  const criarSuperAdminSemMfa = async (): Promise<string> => {
    const email = `super-setup-${randomUUID().slice(0, 8)}@exemplo.test`;

    const usuario = await db.user.create({
      data: { email, passwordHash: await senhas.gerarHash(SENHA) },
    });

    await db.platformAdmin.create({ data: { userId: usuario.id } });

    return email;
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
  /*
   * INSCRICAO -- issue #293.
   *
   * O Super Admin sem MFA recebia `MFA_SETUP` e nao tinha o que fazer com
   * ele: as rotas de inscricao exigiam contexto de tenant, que ele nao tem.
   * Estes testes prendem o caminho novo e, principalmente, as guardas que o
   * impedem de virar um atalho para dentro.
   */
  describe('inscricao no segundo fator', () => {
    it('login de Super Admin SEM mfa devolve desafio de SETUP, e nao sessao', async () => {
      const email = await criarSuperAdminSemMfa();

      const resposta = await logar(email);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({ desafio: 'MFA_SETUP', preAuth: expect.any(String) });
      expect(cookiesDe(resposta)).not.toContainEqual(expect.stringContaining('arenahub_access='));
    });

    it('o pre-auth de SETUP inscreve, confirma e SO ENTAO abre a sessao', async () => {
      const email = await criarSuperAdminSemMfa();
      const login = await logar(email);
      const preAuth = (login.body as { preAuth: string }).preAuth;

      const inscricao = await request(servidor())
        .post('/api/v1/auth/mfa/enroll')
        .set('Authorization', `Bearer ${preAuth}`)
        .send();

      expect(inscricao.status).toBe(200);
      expect(inscricao.body).toMatchObject({
        uri: expect.stringContaining('otpauth://'),
        base32: expect.any(String),
      });

      // A inscricao NAO abre sessao: so a confirmacao abre.
      expect(cookiesDe(inscricao)).not.toContainEqual(expect.stringContaining('arenahub_access='));

      // Enquanto nao confirma, o segundo fator fica PENDING -- ativar antes
      // trancaria a pessoa fora se o autenticador nao lesse o segredo.
      const pendente = await db.user.findUniqueOrThrow({ where: { email } });
      expect(pendente.mfaStatus).toBe('PENDING');

      const segredo = cifrador.decifrar({
        ciphertext: Buffer.from(pendente.mfaSecretCiphertext!),
        iv: Buffer.from(pendente.mfaSecretIv!),
        tag: Buffer.from(pendente.mfaSecretTag!),
      });

      const confirmacao = await request(servidor())
        .post('/api/v1/auth/mfa/enroll/confirm')
        .set('Authorization', `Bearer ${preAuth}`)
        .send({ code: totp.gerarCodigo(segredo, Math.floor(Date.now() / 1000)) });

      expect(confirmacao.status).toBe(200);
      expect(cookiesDe(confirmacao)).toContainEqual(expect.stringContaining('arenahub_access='));

      const ativo = await db.user.findUniqueOrThrow({ where: { email } });
      expect(ativo.mfaStatus).toBe('ENABLED');

      // Sessao de PLATAFORMA: sem tenant.
      const sessao = await db.session.findFirstOrThrow({
        where: { user: { email } },
        orderBy: { createdAt: 'desc' },
      });
      expect(sessao.tenantId).toBeNull();
    });

    it('pre-auth de VERIFY nao serve para reinscrever quem ja tem MFA ativo', async () => {
      // A guarda que importa: sem ela, quem roubasse um pre-auth de VERIFY
      // trocaria o segredo do Super Admin, apagando o autenticador que
      // funciona e ficando com o unico que gera codigo.
      const { email } = await criarSuperAdminComMfa();
      const login = await logar(email);
      const preAuth = (login.body as { preAuth: string }).preAuth;

      const resposta = await request(servidor())
        .post('/api/v1/auth/mfa/enroll')
        .set('Authorization', `Bearer ${preAuth}`)
        .send();

      expect(resposta.status).toBe(401);

      // E o segredo continua intacto: o autenticador antigo ainda vale.
      const usuario = await db.user.findUniqueOrThrow({ where: { email } });
      expect(usuario.mfaStatus).toBe('ENABLED');
    });

    it('pre-auth de SETUP nao abre sessao pela rota de verificacao', async () => {
      /*
       * O caminho inverso: ter a senha nao pode bastar. Sem esta guarda o
       * segundo fator viraria decoracao para quem ainda nao o configurou.
       *
       * O CODIGO ENVIADO E VALIDO, DE PROPOSITO. A primeira versao mandava
       * `'000000'` e passava mesmo com a guarda de `purpose` DESLIGADA: o 401
       * vinha da conferencia do TOTP, nao da guarda sob teste. Com um codigo
       * que o servidor aceita, so a guarda pode recusar -- e o canario que
       * apaga a checagem derruba este teste, como tem de derrubar.
       */
      const email = await criarSuperAdminSemMfa();
      const login = await logar(email);
      const preAuth = (login.body as { preAuth: string }).preAuth;

      await request(servidor())
        .post('/api/v1/auth/mfa/enroll')
        .set('Authorization', `Bearer ${preAuth}`)
        .send();

      const usuario = await db.user.findUniqueOrThrow({ where: { email } });
      const segredo = cifrador.decifrar({
        ciphertext: Buffer.from(usuario.mfaSecretCiphertext!),
        iv: Buffer.from(usuario.mfaSecretIv!),
        tag: Buffer.from(usuario.mfaSecretTag!),
      });

      const resposta = await request(servidor())
        .post('/api/v1/auth/mfa/verify')
        .set('Authorization', `Bearer ${preAuth}`)
        .send({ code: totp.gerarCodigo(segredo, Math.floor(Date.now() / 1000)) });

      expect(resposta.status).toBe(401);
      expect(cookiesDe(resposta)).not.toContainEqual(expect.stringContaining('arenahub_access='));
    });

    it('inscricao sem pre-auth nenhum e recusada', async () => {
      const resposta = await request(servidor()).post('/api/v1/auth/mfa/enroll').send();

      expect(resposta.status).toBe(401);
    });

    it('codigo errado na confirmacao nao ativa o segundo fator nem abre sessao', async () => {
      const email = await criarSuperAdminSemMfa();
      const login = await logar(email);
      const preAuth = (login.body as { preAuth: string }).preAuth;

      await request(servidor())
        .post('/api/v1/auth/mfa/enroll')
        .set('Authorization', `Bearer ${preAuth}`)
        .send();

      const resposta = await request(servidor())
        .post('/api/v1/auth/mfa/enroll/confirm')
        .set('Authorization', `Bearer ${preAuth}`)
        .send({ code: '000000' });

      expect(resposta.status).toBe(401);
      expect(cookiesDe(resposta)).not.toContainEqual(expect.stringContaining('arenahub_access='));

      const usuario = await db.user.findUniqueOrThrow({ where: { email } });
      expect(usuario.mfaStatus).toBe('PENDING');
    });
  });

  /**
   * Issue #296: `mfa/verify` e as rotas de inscricao aceitavam quantos
   * codigos errados o cliente mandasse, por toda a validade do pre-auth.
   */
  describe('forca bruta no segundo fator', () => {
    it('seis codigos errados seguidos bloqueiam mesmo o codigo certo depois', async () => {
      // Molde do limite de login (SPEC-058 AC-7): o bloqueio dispara na
      // tentativa que ULTRAPASSA o limite (limite 5 -> bloqueia na 6a).
      const { email, segredo } = await criarSuperAdminComMfa();
      const login = await logar(email);
      const preAuth = (login.body as { preAuth: string }).preAuth;

      for (let tentativa = 0; tentativa < 5; tentativa++) {
        const resposta = await request(servidor())
          .post('/api/v1/auth/mfa/verify')
          .set('Authorization', `Bearer ${preAuth}`)
          .send({ code: '000000' });

        expect(resposta.status).toBe(401);
      }

      const sexta = await request(servidor())
        .post('/api/v1/auth/mfa/verify')
        .set('Authorization', `Bearer ${preAuth}`)
        .send({ code: '000000' });

      expect(sexta.status).toBe(429);
      expect((sexta.body as { code: string }).code).toBe('MFA_RATE_LIMITED');

      const comCodigoCerto = await request(servidor())
        .post('/api/v1/auth/mfa/verify')
        .set('Authorization', `Bearer ${preAuth}`)
        .send({ code: totp.gerarCodigo(segredo, Math.floor(Date.now() / 1000)) });

      expect(comCodigoCerto.status).toBe(429);
      expect(cookiesDe(comCodigoCerto)).not.toContainEqual(
        expect.stringContaining('arenahub_access='),
      );
    });

    it('codigo certo antes do limite nao soma contra a tentativa errada de outro usuario', async () => {
      // A chave e por usuario (`sub`), nao global: garante que o contador de
      // um Super Admin nao vaza para o proximo.
      const { email, segredo } = await criarSuperAdminComMfa();
      const login = await logar(email);
      const preAuth = (login.body as { preAuth: string }).preAuth;

      const resposta = await request(servidor())
        .post('/api/v1/auth/mfa/verify')
        .set('Authorization', `Bearer ${preAuth}`)
        .send({ code: totp.gerarCodigo(segredo, Math.floor(Date.now() / 1000)) });

      expect(resposta.status).toBe(200);
    });
  });
});
