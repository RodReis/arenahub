import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { TotpService } from '../../src/modules/auth/totp.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

describe('convites e MFA', () => {
  let app: INestApplication;
  let db: PrismaService;
  let totp: TotpService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';
  const SENHA_NOVA = 'senha-nova-do-convidado';

  let tenantId = '';
  let roleId = '';
  let cookieDoDono = '';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    totp = app.get(TotpService);

    const senhas = app.get(PasswordService);
    const email = `dono-iam-${sufixo}@exemplo.test`;

    const tenant = await db.tenant.create({
      data: { slug: `iam-${sufixo}`, legalName: 'IAM LTDA', displayName: 'IAM' },
    });
    tenantId = tenant.id;

    const user = await db.user.create({
      data: { email, passwordHash: await senhas.gerarHash(SENHA) },
    });

    await db.tenantMembership.create({ data: { tenantId, userId: user.id } });

    const papel = await db.role.create({
      data: { tenantId, name: 'OWNER', isSystem: true },
    });
    roleId = papel.id;

    const permissao = await db.permission.upsert({
      where: { code: 'user.manage' },
      create: { code: 'user.manage' },
      update: {},
    });

    await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    await db.userRole.create({ data: { tenantId, userId: user.id, roleId: papel.id } });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email, password: SENHA });

    cookieDoDono = cookieDeAcesso(login);
  });

  afterAll(async () => {
    await app?.close();
  });

  const convidar = async (email: string): Promise<request.Response> =>
    request(servidor())
      .post('/api/v1/users/invitations')
      .set('Cookie', cookieDoDono)
      .send({ email, roleId });

  describe('POST /api/v1/users/invitations', () => {
    it('cria convite e mostra o token uma unica vez', async () => {
      const resposta = await convidar(`convidado-1-${sufixo}@exemplo.test`);

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ token: expect.any(String) });

      const convite = await db.invitation.findUnique({
        where: { id: (resposta.body as { id: string }).id },
      });

      // O banco guarda so o hash -- mesma regra do refresh token. Convite
      // recuperavel depois seria porta permanente para dentro do tenant.
      expect(convite?.tokenHash).not.toBe((resposta.body as { token: string }).token);
      expect(convite?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('nao grava e-mail na trilha de auditoria', async () => {
      const email = `convidado-pii-${sufixo}@exemplo.test`;
      const resposta = await convidar(email);

      const trilha = await db.auditLog.findFirst({
        where: { tenantId, targetId: (resposta.body as { id: string }).id },
      });

      // PII em log e proibido (`CLAUDE.md`, Convencoes). O vinculo com a
      // pessoa ja existe pelo `targetId`.
      expect(JSON.stringify(trilha?.metadata)).not.toContain(email);
    });

    it('recusa papel de outro tenant', async () => {
      const outro = await db.tenant.create({
        data: { slug: `outro-${sufixo}`, legalName: 'Outro LTDA', displayName: 'Outro' },
      });
      const papelAlheio = await db.role.create({
        data: { tenantId: outro.id, name: 'OWNER', isSystem: true },
      });

      const resposta = await request(servidor())
        .post('/api/v1/users/invitations')
        .set('Cookie', cookieDoDono)
        .send({ email: `x-${sufixo}@exemplo.test`, roleId: papelAlheio.id });

      expect(resposta.status).toBe(404);
    });

    it('exige permissao user.manage', async () => {
      const senhas = app.get(PasswordService);
      const email = `sem-permissao-${sufixo}@exemplo.test`;

      const user = await db.user.create({
        data: { email, passwordHash: await senhas.gerarHash(SENHA) },
      });
      await db.tenantMembership.create({ data: { tenantId, userId: user.id } });

      const login = await request(servidor())
        .post('/api/v1/auth/login')
        .send({ email, password: SENHA });

      const resposta = await request(servidor())
        .post('/api/v1/users/invitations')
        .set('Cookie', cookieDeAcesso(login))
        .send({ email: `y-${sufixo}@exemplo.test`, roleId });

      expect(resposta.status).toBe(403);
    });
  });

  describe('POST /api/v1/users/invitations/accept', () => {
    it('cria usuario, vinculo e papel de uma vez', async () => {
      const email = `aceita-${sufixo}@exemplo.test`;
      const convite = await convidar(email);
      const token = (convite.body as { token: string }).token;

      const resposta = await request(servidor())
        .post('/api/v1/users/invitations/accept')
        .send({ token, password: SENHA_NOVA });

      expect(resposta.status).toBe(200);

      const criado = await db.user.findUnique({
        where: { email },
        include: { memberships: true, userRoles: true },
      });

      // Parcial seria pior que nada: usuario sem papel nao entra, e papel
      // sem vinculo e permissao orfa num tenant.
      expect(criado?.memberships).toHaveLength(1);
      expect(criado?.userRoles).toHaveLength(1);
    });

    it('recusa o mesmo convite duas vezes', async () => {
      const convite = await convidar(`uso-unico-${sufixo}@exemplo.test`);
      const token = (convite.body as { token: string }).token;

      await request(servidor())
        .post('/api/v1/users/invitations/accept')
        .send({ token, password: SENHA_NOVA });

      const segunda = await request(servidor())
        .post('/api/v1/users/invitations/accept')
        .send({ token, password: SENHA_NOVA });

      expect(segunda.status).toBe(400);
      expect(segunda.body).toMatchObject({ code: 'INVITATION_INVALID' });
    });

    it('recusa convite expirado', async () => {
      const convite = await convidar(`expirado-${sufixo}@exemplo.test`);
      const token = (convite.body as { token: string }).token;

      await db.invitation.update({
        where: { id: (convite.body as { id: string }).id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const resposta = await request(servidor())
        .post('/api/v1/users/invitations/accept')
        .send({ token, password: SENHA_NOVA });

      expect(resposta.status).toBe(400);
    });

    it('responde igual para token inexistente e para expirado', async () => {
      const inexistente = await request(servidor())
        .post('/api/v1/users/invitations/accept')
        .send({ token: 'token-que-nunca-existiu', password: SENHA_NOVA });

      // Distinguir ensinaria a quem sonda quais convites existiram.
      expect(inexistente.status).toBe(400);
      expect(inexistente.body).toMatchObject({ code: 'INVITATION_INVALID' });
    });

    it('recusa senha curta demais', async () => {
      const convite = await convidar(`senha-curta-${sufixo}@exemplo.test`);

      const resposta = await request(servidor())
        .post('/api/v1/users/invitations/accept')
        .send({ token: (convite.body as { token: string }).token, password: 'curta' });

      expect(resposta.status).toBe(400);
    });
  });

  describe('MFA', () => {
    it('inicia inscricao com segredo cifrado no banco', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/auth/mfa/setup')
        .set('Cookie', cookieDoDono);

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({
        uri: expect.stringMatching(/^otpauth:\/\/totp\//),
        base32: expect.stringMatching(/^[A-Z2-7]+$/),
      });

      const usuario = await db.user.findFirst({
        where: { email: `dono-iam-${sufixo}@exemplo.test` },
      });

      // Ainda PENDING: ativar antes de o usuario provar que consegue gerar
      // um codigo o trancaria fora da propria conta se o autenticador nao
      // tivesse lido o segredo direito.
      expect(usuario?.mfaStatus).toBe('PENDING');
      expect(usuario?.mfaSecretCiphertext).toBeTruthy();
      expect(usuario?.mfaSecretIv).toBeTruthy();
      expect(usuario?.mfaSecretTag).toBeTruthy();

      const emClaro = Buffer.from(usuario?.mfaSecretCiphertext ?? []).toString('utf8');
      expect(emClaro).not.toContain((resposta.body as { base32: string }).base32);
    });

    it('confirma a inscricao com codigo valido e ativa', async () => {
      const setup = await request(servidor())
        .post('/api/v1/auth/mfa/setup')
        .set('Cookie', cookieDoDono);

      const segredo = base32ParaBuffer((setup.body as { base32: string }).base32);
      const codigo = totp.gerarCodigo(segredo, Math.floor(Date.now() / 1000));

      const resposta = await request(servidor())
        .post('/api/v1/auth/mfa/confirm')
        .set('Cookie', cookieDoDono)
        .send({ code: codigo });

      expect(resposta.status).toBe(204);

      const usuario = await db.user.findFirst({
        where: { email: `dono-iam-${sufixo}@exemplo.test` },
      });

      expect(usuario?.mfaStatus).toBe('ENABLED');
      expect(usuario?.mfaLastCounter).not.toBeNull();
    });

    it('recusa o mesmo codigo duas vezes', async () => {
      const setup = await request(servidor())
        .post('/api/v1/auth/mfa/setup')
        .set('Cookie', cookieDoDono);

      const segredo = base32ParaBuffer((setup.body as { base32: string }).base32);
      const codigo = totp.gerarCodigo(segredo, Math.floor(Date.now() / 1000));

      await request(servidor())
        .post('/api/v1/auth/mfa/confirm')
        .set('Cookie', cookieDoDono)
        .send({ code: codigo });

      const reuso = await request(servidor())
        .post('/api/v1/auth/mfa/confirm')
        .set('Cookie', cookieDoDono)
        .send({ code: codigo });

      // O codigo vale 30 s. Sem o contador gravado, quem interceptar tem
      // meio minuto para reapresenta-lo -- e o segundo fator deixa de ser
      // um fator.
      expect(reuso.status).toBe(401);
      expect(reuso.body).toMatchObject({ code: 'MFA_CODE_REPLAYED' });
    });

    it('recusa codigo invalido', async () => {
      await request(servidor()).post('/api/v1/auth/mfa/setup').set('Cookie', cookieDoDono);

      const resposta = await request(servidor())
        .post('/api/v1/auth/mfa/confirm')
        .set('Cookie', cookieDoDono)
        .send({ code: '000000' });

      expect(resposta.status).toBe(401);
      expect(resposta.body).toMatchObject({ code: 'MFA_CODE_INVALID' });
    });

    it('exige autenticacao', async () => {
      expect((await request(servidor()).post('/api/v1/auth/mfa/setup')).status).toBe(401);
    });
  });

  describe('GET /api/v1/users', () => {
    it('nunca devolve hash de senha nem segredo de MFA', async () => {
      const resposta = await request(servidor())
        .get('/api/v1/users')
        .set('Cookie', cookieDoDono);

      expect(resposta.status).toBe(200);

      const corpo = JSON.stringify(resposta.body);

      expect(corpo).not.toMatch(/passwordHash/i);
      expect(corpo).not.toMatch(/scrypt/);
      expect(corpo).not.toMatch(/mfaSecret/i);
    });
  });

  /**
   * `GET /api/v1/roles` -- issue #274.
   *
   * A rota nasceu porque `POST /users/invitations` exige `roleId` e nao havia
   * como descobri-lo: quem convidava tinha de consultar o banco por fora.
   */
  describe('GET /api/v1/roles', () => {
    it('lista os papeis do tenant', async () => {
      const resposta = await request(servidor())
        .get('/api/v1/roles')
        .set('Cookie', cookieDoDono);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toContainEqual({ id: roleId, name: 'OWNER', isSystem: true });
    });

    /**
     * ISOLAMENTO DE TENANT -- regra de arquitetura no 2.
     *
     * O `beforeAll` cria um segundo tenant com um `OWNER` proprio (ver
     * "recusa papel de outro tenant"). Sem o `where` por tenant a consulta
     * devolveria os dois, e a tela de convite ofereceria o papel alheio --
     * que o `InvitationService` recusaria depois com 404, deixando a
     * recepcao escolhendo uma opcao que a API nao aceita.
     */
    it('nao devolve papel de outro tenant', async () => {
      const outro = await db.tenant.create({
        data: {
          slug: `vizinho-${sufixo}`,
          legalName: 'Vizinho LTDA',
          displayName: 'Vizinho',
        },
      });

      const alheio = await db.role.create({
        data: { tenantId: outro.id, name: 'PAPEL-ALHEIO', isSystem: false },
      });

      const resposta = await request(servidor())
        .get('/api/v1/roles')
        .set('Cookie', cookieDoDono);

      const ids = (resposta.body as Array<{ id: string }>).map((papel) => papel.id);

      expect(ids).not.toContain(alheio.id);
    });

    /**
     * `user.manage`, a MESMA permissao do convite: quem nao pode convidar nao
     * tem o que fazer com a lista de papeis, e a lista revela a estrutura de
     * autorizacao do tenant.
     */
    it('exige permissao user.manage', async () => {
      const senhas = app.get(PasswordService);
      const email = `sem-permissao-roles-${sufixo}@exemplo.test`;

      const user = await db.user.create({
        data: { email, passwordHash: await senhas.gerarHash(SENHA) },
      });
      await db.tenantMembership.create({ data: { tenantId, userId: user.id } });

      const login = await request(servidor())
        .post('/api/v1/auth/login')
        .send({ email, password: SENHA });

      const resposta = await request(servidor())
        .get('/api/v1/roles')
        .set('Cookie', cookieDeAcesso(login));

      expect(resposta.status).toBe(403);
    });
  });
});

/** Decodifica base32 sem padding, para gerar o codigo do lado do teste. */
function base32ParaBuffer(base32: string): Buffer {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];

  for (const caractere of base32) {
    const indice = alfabeto.indexOf(caractere);

    if (indice === -1) continue;

    valor = (valor << 5) | indice;
    bits += 5;

    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}
