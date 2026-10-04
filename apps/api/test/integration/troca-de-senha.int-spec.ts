import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Troca da propria senha e leitura do perfil -- SPEC-XXX.
 *
 * Cada usuario nasce no proprio teste: a troca muda a senha e conta
 * tentativas por usuario, e um usuario compartilhado faria um teste herdar
 * a senha (ou o bloqueio) do anterior.
 */
describe('troca de senha e perfil', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;
  const tenants: string[] = [];

  const SENHA = 'senha-de-teste-correta';
  const NOVA = 'senha-nova-de-teste';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDe = (resposta: request.Response, nome: string): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return (lista.find((c) => c.startsWith(`${nome}=`)) ?? '').split(';')[0] ?? '';
  };

  const criarTenant = async (): Promise<string> => {
    const sufixo = randomUUID().slice(0, 8);
    const tenant = await db.tenant.create({
      data: {
        slug: `senha-${sufixo}`,
        legalName: 'Academia Senha LTDA',
        displayName: `Academia Senha ${sufixo}`,
        timezone: 'America/Sao_Paulo',
      },
    });
    tenants.push(tenant.id);

    return tenant.id;
  };

  /** Usuario com papel OWNER num tenant novo. Devolve e-mail e ids. */
  const criarUsuario = async (): Promise<{ email: string; userId: string; tenantId: string }> => {
    const tenantId = await criarTenant();
    const email = `troca-${randomUUID().slice(0, 8)}@exemplo.test`;
    const usuario = await db.user.create({
      data: { email, passwordHash: await senhas.gerarHash(SENHA) },
    });
    await db.tenantMembership.create({ data: { tenantId, userId: usuario.id } });
    const papel = await db.role.create({ data: { tenantId, name: 'OWNER', isSystem: true } });
    await db.userRole.create({ data: { tenantId, userId: usuario.id, roleId: papel.id } });

    return { email, userId: usuario.id, tenantId };
  };

  /** Loga e devolve os dois cookies prontos para `.set('Cookie', ...)`. */
  const logar = async (
    email: string,
    senha = SENHA,
  ): Promise<{ acesso: string; refresh: string; status: number }> => {
    const resposta = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email, password: senha });

    return {
      status: resposta.status,
      acesso: cookieDe(resposta, 'arenahub_access'),
      refresh: cookieDe(resposta, 'arenahub_refresh'),
    };
  };

  const trocar = (acesso: string, corpo: unknown): request.Test =>
    request(servidor())
      .post('/api/v1/auth/password')
      .set('Cookie', acesso)
      .send(corpo as object);

  const renovar = (refresh: string): request.Test =>
    request(servidor()).post('/api/v1/auth/refresh').set('Cookie', refresh);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);
  });

  afterAll(async () => {
    // Suite que cria tenant apaga o que criou: acumular tenant de teste ja
    // virou timeout que parecia defeito do codigo.
    if (db) {
      await db.session.deleteMany({ where: { tenantId: { in: tenants } } });
      await db.tenant.deleteMany({ where: { id: { in: tenants } } });
    }
    await app?.close();
  });

  describe('POST /api/v1/auth/password', () => {
    it('troca a senha: a antiga para de entrar e a nova entra', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      const resposta = await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: NOVA });

      expect(resposta.status).toBe(204);
      expect((await logar(email, SENHA)).status).toBe(401);
      expect((await logar(email, NOVA)).status).toBe(200);
    });

    it('mantem a sessao atual e encerra as outras', async () => {
      const { email } = await criarUsuario();
      const atual = await logar(email);
      const outra = await logar(email);

      expect(
        (await trocar(atual.acesso, { currentPassword: SENHA, newPassword: NOVA })).status,
      ).toBe(204);

      // A atual continua renovando: o refresh dela segue valendo.
      expect((await renovar(atual.refresh)).status).toBe(200);
      // A outra nao renova mais -- e isso que a derruba (o access token dela
      // vence em ate 10 min; o guard nao consulta a sessao, SPEC §8).
      expect((await renovar(outra.refresh)).status).toBe(401);

      const revogadas = await db.session.count({
        where: { revokedReason: 'password_changed', user: { email } },
      });
      expect(revogadas).toBeGreaterThan(0);
    });

    it('mantem a familia mesmo quando o elo do token ja foi rotacionado', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      // O painel renova em paralelo: o access ANTIGO aponta para um elo ROTATED.
      const renovada = await renovar(sessao.refresh);
      const refreshNovo = cookieDe(renovada, 'arenahub_refresh');

      expect(
        (await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: NOVA })).status,
      ).toBe(204);
      expect((await renovar(refreshNovo)).status).toBe(200);
    });

    it('derruba as sessoes do mesmo usuario em outro tenant', async () => {
      const { email, userId } = await criarUsuario();
      const outroTenant = await criarTenant();
      await db.tenantMembership.create({ data: { tenantId: outroTenant, userId } });

      const sessao = await logar(email);
      const familiaDeFora = randomUUID();
      await db.session.create({
        data: {
          userId,
          tenantId: outroTenant,
          tokenHash: randomUUID(),
          familyId: familiaDeFora,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      expect(
        (await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: NOVA })).status,
      ).toBe(204);

      const deFora = await db.session.findFirst({ where: { familyId: familiaDeFora } });
      expect(deFora?.status).toBe('REVOKED');
    });

    it('senha atual errada responde 422 e nao muda nada', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      const resposta = await trocar(sessao.acesso, {
        currentPassword: 'errada-errada',
        newPassword: NOVA,
      });

      expect(resposta.status).toBe(422);
      expect(resposta.body).toMatchObject({ code: 'AUTH_CURRENT_PASSWORD_INVALID' });
      expect((await logar(email, SENHA)).status).toBe(200);
    });

    it('recusa nova senha igual a atual', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      const resposta = await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: SENHA });

      expect(resposta.status).toBe(422);
      expect(resposta.body).toMatchObject({ code: 'AUTH_PASSWORD_UNCHANGED' });
    });

    it('recusa nova senha abaixo de 8 caracteres', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      expect(
        (await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: '1234567' })).status,
      ).toBe(400);
      // A fronteira: 8 passa.
      expect(
        (await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: '12345678' })).status,
      ).toBe(204);
    });

    it('recusa campo desconhecido no corpo (INV-002)', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      const resposta = await trocar(sessao.acesso, {
        currentPassword: SENHA,
        newPassword: NOVA,
        userId: randomUUID(),
      });

      expect(resposta.status).toBe(400);
      expect((await logar(email, SENHA)).status).toBe(200);
    });

    it('duas trocas simultaneas com a mesma senha atual: so uma grava', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      const [a, b] = await Promise.all([
        trocar(sessao.acesso, { currentPassword: SENHA, newPassword: 'primeira-nova-senha' }),
        trocar(sessao.acesso, { currentPassword: SENHA, newPassword: 'segunda-nova-senha' }),
      ]);

      // O invariante, nao a ordem: exatamente um 204, e a senha final e a
      // daquele que venceu.
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([204, 422]);

      const venceu = a.status === 204 ? 'primeira-nova-senha' : 'segunda-nova-senha';
      expect((await logar(email, venceu)).status).toBe(200);
    });

    it('bloqueia com 429 na decima primeira tentativa do minuto', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      for (let i = 0; i < 10; i += 1) {
        await trocar(sessao.acesso, { currentPassword: `errada-${i}-xx`, newPassword: NOVA });
      }

      // Mesmo com a senha CERTA: o contador soma toda tentativa (molde do MFA).
      const resposta = await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: NOVA });

      expect(resposta.status).toBe(429);
      expect(resposta.body).toMatchObject({ code: 'AUTH_PASSWORD_CHANGE_RATE_LIMITED' });
    });

    it('audita a troca sem nenhum valor de senha', async () => {
      const { email, userId, tenantId } = await criarUsuario();
      const sessao = await logar(email);

      await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: NOVA });

      const registro = await db.auditLog.findFirst({
        where: { tenantId, action: 'user.password_changed', targetId: userId },
      });
      expect(registro).not.toBeNull();
      expect(JSON.stringify(registro)).not.toContain(SENHA);
      expect(JSON.stringify(registro)).not.toContain(NOVA);
    });

    it('recusa sem sessao', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/auth/password')
        .send({ currentPassword: SENHA, newPassword: NOVA });

      expect(resposta.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/profile', () => {
    it('devolve e-mail, papeis, academia e data de criacao', async () => {
      const { email, tenantId } = await criarUsuario();
      const sessao = await logar(email);

      const resposta = await request(servidor())
        .get('/api/v1/auth/profile')
        .set('Cookie', sessao.acesso);

      expect(resposta.status).toBe(200);
      const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(resposta.body).toEqual({
        email,
        createdAt: expect.any(String),
        roles: ['OWNER'],
        tenant: { displayName: tenant.displayName, timezone: 'America/Sao_Paulo' },
      });
    });

    it('nunca devolve hash nem segredo de MFA', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      const corpo = JSON.stringify(
        (await request(servidor()).get('/api/v1/auth/profile').set('Cookie', sessao.acesso)).body,
      );

      expect(corpo).not.toMatch(/scrypt|passwordHash|mfaSecret/i);
    });

    it('recusa sem sessao', async () => {
      expect((await request(servidor()).get('/api/v1/auth/profile')).status).toBe(401);
    });
  });
});
