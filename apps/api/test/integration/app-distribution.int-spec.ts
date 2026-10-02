import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Issue #534 -- `AppDistributionController`, provado pela porta da frente.
 *
 * Uma academia, dois usuarios: o gerente (`user.manage` + `student.read`) e a
 * recepcao (so `student.read`). E uma segunda academia para provar que o link
 * de uma nunca aparece na outra.
 */
describe('AppDistributionController (#534)', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const gerente = { email: `gerente-${sufixo}@exemplo.test`, cookie: '' };
  const recepcao = { email: `recepcao-${sufixo}@exemplo.test`, cookie: '' };
  const outraAcademia = { email: `outra-${sufixo}@exemplo.test`, cookie: '' };
  const tenants: string[] = [];

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  const criarUsuario = async (
    tenantId: string,
    conta: { email: string; cookie: string },
    nomeDoPapel: string,
    permissoes: string[],
  ): Promise<void> => {
    const senhas = app.get(PasswordService);
    const user = await db.user.create({
      data: { email: conta.email, passwordHash: await senhas.gerarHash(SENHA) },
    });
    await db.tenantMembership.create({ data: { tenantId, userId: user.id } });

    const papel = await db.role.create({ data: { tenantId, name: nomeDoPapel } });
    const registros = await Promise.all(
      permissoes.map((code) =>
        db.permission.upsert({ where: { code }, create: { code }, update: {} }),
      ),
    );
    await db.rolePermission.createMany({
      data: registros.map((p) => ({ roleId: papel.id, permissionId: p.id })),
    });
    await db.userRole.create({ data: { tenantId, userId: user.id, roleId: papel.id } });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: conta.email, password: SENHA });
    conta.cookie = cookieDeAcesso(login);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    const a = await db.tenant.create({
      data: { slug: `app-dist-a-${sufixo}`, legalName: `A ${sufixo}`, displayName: `A ${sufixo}` },
    });
    const b = await db.tenant.create({
      data: { slug: `app-dist-b-${sufixo}`, legalName: `B ${sufixo}`, displayName: `B ${sufixo}` },
    });
    tenants.push(a.id, b.id);

    await criarUsuario(a.id, gerente, 'MANAGER', ['student.read', 'user.manage']);
    await criarUsuario(a.id, recepcao, 'RECEPTION', ['student.read']);
    await criarUsuario(b.id, outraAcademia, 'OWNER', ['student.read', 'user.manage']);
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: tenants } } });
    await db.user.deleteMany({
      where: { email: { in: [gerente.email, recepcao.email, outraAcademia.email] } },
    });
    await app?.close();
  });

  const obter = (cookie: string) =>
    request(servidor()).get('/api/v1/app-distribution').set('Cookie', cookie);
  const salvar = (cookie: string, corpo: object) =>
    request(servidor()).put('/api/v1/app-distribution').set('Cookie', cookie).send(corpo);

  it('GET sem configuracao devolve nulos', async () => {
    const resposta = await obter(recepcao.cookie);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      androidUrl: null,
      androidVersion: null,
      updatedAt: null,
      updatedByEmail: null,
      updatedByRole: null,
      shortSlug: null,
      messageTemplate: null,
      academia: `A ${sufixo}`,
      slugSugerido: `app-dist-a-${sufixo}`,
    });
  });

  it('PUT salva, devolve quem salvou e a recepcao le', async () => {
    const put = await salvar(gerente.cookie, {
      androidUrl: 'https://expo.dev/a.apk',
      androidVersion: '0.1.0 (build 8)',
    });

    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      androidUrl: 'https://expo.dev/a.apk',
      androidVersion: '0.1.0 (build 8)',
      updatedByEmail: gerente.email,
      updatedByRole: 'MANAGER',
    });

    const get = await obter(recepcao.cookie);
    expect((get.body as { androidUrl: string }).androidUrl).toBe('https://expo.dev/a.apk');
  });

  it.each(['http://expo.dev/a.apk', 'javascript:alert(1)', ''])(
    'PUT recusa a URL "%s" com 400',
    async (url) => {
      const resposta = await salvar(gerente.cookie, { androidUrl: url });

      expect(resposta.status).toBe(400);
    },
  );

  it('PUT sem user.manage devolve 403', async () => {
    const resposta = await salvar(recepcao.cookie, { androidUrl: 'https://expo.dev/z.apk' });

    expect(resposta.status).toBe(403);
  });

  it('PUT recusa tenantId no corpo (strict)', async () => {
    const resposta = await salvar(gerente.cookie, {
      androidUrl: 'https://expo.dev/a.apk',
      tenantId: randomUUID(),
    });

    expect(resposta.status).toBe(400);
  });

  it('a outra academia nao ve o link da primeira', async () => {
    const resposta = await obter(outraAcademia.cookie);

    expect((resposta.body as { androidUrl: string | null }).androidUrl).toBeNull();
  });

  it('DELETE sem user.manage devolve 403 e com user.manage remove', async () => {
    const negado = await request(servidor())
      .delete('/api/v1/app-distribution')
      .set('Cookie', recepcao.cookie);
    expect(negado.status).toBe(403);

    const feito = await request(servidor())
      .delete('/api/v1/app-distribution')
      .set('Cookie', gerente.cookie);
    expect(feito.status).toBe(200);
    expect((feito.body as { androidUrl: string | null }).androidUrl).toBeNull();

    const depois = await obter(recepcao.cookie);
    expect((depois.body as { androidUrl: string | null }).androidUrl).toBeNull();
  });
  describe('link curto e mensagem (#538)', () => {
    const publico = (slug: string) => request(servidor()).get(`/api/v1/public/app-links/${slug}`);

    it('PUT grava final do link e mensagem; GET devolve os dois', async () => {
      const put = await salvar(gerente.cookie, {
        androidUrl: 'https://expo.dev/curto.apk',
        shortSlug: `arena-${sufixo}`,
        messageTemplate: 'Baixe o app da {academia}: {link}',
      });

      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({
        shortSlug: `arena-${sufixo}`,
        messageTemplate: 'Baixe o app da {academia}: {link}',
      });
    });

    it('a rota publica resolve o final do link para o APK atual, sem login', async () => {
      const resposta = await publico(`arena-${sufixo}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({
        androidUrl: 'https://expo.dev/curto.apk',
        tenantSlug: `app-dist-a-${sufixo}`,
      });
    });

    it('final inexistente ou invalido responde 404', async () => {
      expect((await publico(`nao-existe-${sufixo}`)).status).toBe(404);
      expect((await publico('X')).status).toBe(404);
    });

    it('final ja usado por OUTRA academia responde 409 e nao rouba o link', async () => {
      const resposta = await salvar(outraAcademia.cookie, {
        androidUrl: 'https://expo.dev/outra.apk',
        shortSlug: `arena-${sufixo}`,
      });

      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('APP_LINK_SLUG_TAKEN');
      expect((await publico(`arena-${sufixo}`)).body).toMatchObject({ androidUrl: 'https://expo.dev/curto.apk' });
    });

    it.each(['ab', 'Arena', 'com espaco', '-arena'])('PUT recusa o final "%s" com 400', async (slug) => {
      const resposta = await salvar(gerente.cookie, { androidUrl: 'https://expo.dev/curto.apk', shortSlug: slug });

      expect(resposta.status).toBe(400);
    });

    it('remover o instalador mantem o final reservado; o link publico responde sem APK ate um novo', async () => {
      await request(servidor()).delete('/api/v1/app-distribution').set('Cookie', gerente.cookie).expect(200);

      // 200 e nao 404: o final EXISTE (a pagina mostra a academia e "indisponivel").
      const semApk = await publico(`arena-${sufixo}`);
      expect(semApk.status).toBe(200);
      expect(semApk.body).toEqual({ androidUrl: null, tenantSlug: `app-dist-a-${sufixo}` });
      expect((await obter(recepcao.cookie)).body).toMatchObject({ shortSlug: `arena-${sufixo}` });

      await salvar(gerente.cookie, { androidUrl: 'https://expo.dev/novo.apk' });

      expect((await publico(`arena-${sufixo}`)).body).toMatchObject({ androidUrl: 'https://expo.dev/novo.apk' });
    });
  });
  describe('final antigo vira apelido permanente (#538, revisao)', () => {
    const publico = (slug: string) => request(servidor()).get(`/api/v1/public/app-links/${slug}`);

    it('trocar o final mantem o antigo levando ao APK da MESMA academia', async () => {
      await salvar(gerente.cookie, { androidUrl: 'https://expo.dev/a1.apk', shortSlug: `velho-${sufixo}` });
      await salvar(gerente.cookie, { androidUrl: 'https://expo.dev/a1.apk', shortSlug: `novo-${sufixo}` });

      expect((await obter(recepcao.cookie)).body).toMatchObject({ shortSlug: `novo-${sufixo}` });
      expect((await publico(`novo-${sufixo}`)).body).toMatchObject({ androidUrl: 'https://expo.dev/a1.apk' });
      expect((await publico(`velho-${sufixo}`)).body).toMatchObject({ androidUrl: 'https://expo.dev/a1.apk' });
    });

    it('outra academia NAO pega o final antigo -- o QR impresso nao muda de dono', async () => {
      const resposta = await salvar(outraAcademia.cookie, {
        androidUrl: 'https://expo.dev/b1.apk',
        shortSlug: `velho-${sufixo}`,
      });

      expect(resposta.status).toBe(409);
      expect((await publico(`velho-${sufixo}`)).body).toMatchObject({ androidUrl: 'https://expo.dev/a1.apk' });
    });

    it('voltar para um final antigo da propria academia funciona', async () => {
      const resposta = await salvar(gerente.cookie, {
        androidUrl: 'https://expo.dev/a1.apk',
        shortSlug: `velho-${sufixo}`,
      });

      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({ shortSlug: `velho-${sufixo}` });
    });

    it('PUT sem shortSlug nao mexe no final', async () => {
      await salvar(gerente.cookie, { androidUrl: 'https://expo.dev/a2.apk' });

      expect((await obter(recepcao.cookie)).body).toMatchObject({ shortSlug: `velho-${sufixo}` });
    });
  });
});
