import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Isolamento entre tenants, provado pela porta da frente.
 *
 * O teste do `packages/database` prova as CONSTRAINTS; este prova o
 * COMPORTAMENTO -- que a API nao deixa o tenant A ler, alterar ou sequer
 * confirmar a existencia de dado do tenant B. `M1-NFR-007` exige teste de
 * isolamento em toda consulta multi-tenant critica; `M1-AC-001` exige que o
 * proprietario crie unidade e usuarios sem cruzamento.
 *
 * Os dois tenants usam DE PROPOSITO o mesmo codigo de unidade: se o
 * isolamento vazar, o teste acusa em vez de passar por coincidencia de
 * identificadores diferentes.
 */
describe('isolamento entre tenants', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';
  const CODIGO_COMPARTILHADO = 'CENTRO';

  const contas = {
    a: { email: `dono-a-${sufixo}@exemplo.test`, tenantId: '', unidadeId: '', cookie: '' },
    b: { email: `dono-b-${sufixo}@exemplo.test`, tenantId: '', unidadeId: '', cookie: '' },
  };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  /** Cria tenant com dono, papel OWNER e uma unidade. */
  const montarAcademia = async (
    conta: { email: string; tenantId: string; unidadeId: string; cookie: string },
    slug: string,
  ): Promise<void> => {
    const senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: { slug, legalName: `${slug} LTDA`, displayName: slug },
    });

    const user = await db.user.create({
      data: { email: conta.email, passwordHash: await senhas.gerarHash(SENHA) },
    });

    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id } });

    const papel = await db.role.create({
      data: { tenantId: tenant.id, name: 'OWNER', isSystem: true },
    });

    const permissoes = await Promise.all(
      ['unit.create', 'unit.read', 'unit.update'].map((code) =>
        db.permission.upsert({ where: { code }, create: { code }, update: {} }),
      ),
    );

    await db.rolePermission.createMany({
      data: permissoes.map((p) => ({ roleId: papel.id, permissionId: p.id })),
    });

    await db.userRole.create({
      data: { tenantId: tenant.id, userId: user.id, roleId: papel.id },
    });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: CODIGO_COMPARTILHADO,
        name: `Centro ${slug}`,
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: conta.email, password: SENHA });

    conta.tenantId = tenant.id;
    conta.unidadeId = unidade.id;
    conta.cookie = cookieDeAcesso(login);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    await montarAcademia(contas.a, `rede-a-${sufixo}`);
    await montarAcademia(contas.b, `rede-b-${sufixo}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /api/v1/units', () => {
    it('lista apenas as unidades do proprio tenant', async () => {
      const resposta = await request(servidor())
        .get('/api/v1/units')
        .set('Cookie', contas.a.cookie);

      expect(resposta.status).toBe(200);

      const ids = (resposta.body as { id: string }[]).map((u) => u.id);

      expect(ids).toContain(contas.a.unidadeId);
      expect(ids).not.toContain(contas.b.unidadeId);
    });

    it('nao aceita tenantId vindo do cliente', async () => {
      // Regra de arquitetura no 2: o tenant vem da identidade autenticada.
      // Se a query pudesse escolher o tenant, todo o isolamento viraria
      // sugestao.
      const resposta = await request(servidor())
        .get(`/api/v1/units?tenantId=${contas.b.tenantId}`)
        .set('Cookie', contas.a.cookie);

      const ids = (resposta.body as { id: string }[]).map((u) => u.id);

      expect(ids).not.toContain(contas.b.unidadeId);
    });
  });

  describe('GET /api/v1/units/:id', () => {
    it('devolve a unidade do proprio tenant', async () => {
      const resposta = await request(servidor())
        .get(`/api/v1/units/${contas.a.unidadeId}`)
        .set('Cookie', contas.a.cookie);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({ id: contas.a.unidadeId });
    });

    it('responde 404 para unidade de outro tenant, nao 403', async () => {
      const resposta = await request(servidor())
        .get(`/api/v1/units/${contas.b.unidadeId}`)
        .set('Cookie', contas.a.cookie);

      // 403 confirmaria que o recurso EXISTE -- o atacante aprende que
      // acertou o UUID. 404 nao distingue "nao existe" de "nao e seu".
      expect(resposta.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/units/:id', () => {
    it('altera a unidade do proprio tenant', async () => {
      const resposta = await request(servidor())
        .patch(`/api/v1/units/${contas.a.unidadeId}`)
        .set('Cookie', contas.a.cookie)
        .send({ name: 'Centro Renomeado' });

      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({ name: 'Centro Renomeado' });
    });

    it('nao altera unidade de outro tenant', async () => {
      const antes = await db.gymUnit.findUnique({ where: { id: contas.b.unidadeId } });

      const resposta = await request(servidor())
        .patch(`/api/v1/units/${contas.b.unidadeId}`)
        .set('Cookie', contas.a.cookie)
        .send({ name: 'Invadido' });

      expect(resposta.status).toBe(404);

      const depois = await db.gymUnit.findUnique({ where: { id: contas.b.unidadeId } });

      // Nao basta a resposta ser 404: o dado tem de continuar intacto.
      expect(depois?.name).toBe(antes?.name);
    });
  });

  describe('POST /api/v1/units', () => {
    it('cria unidade no tenant da identidade autenticada', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/units')
        .set('Cookie', contas.a.cookie)
        .send({
          code: `NOVA-${sufixo}`,
          name: 'Unidade Nova',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        });

      expect(resposta.status).toBe(201);

      const criada = await db.gymUnit.findUnique({
        where: { id: (resposta.body as { id: string }).id },
      });

      expect(criada?.tenantId).toBe(contas.a.tenantId);
    });

    it('recusa tenantId no corpo', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/units')
        .set('Cookie', contas.a.cookie)
        .send({
          code: `HACK-${sufixo}`,
          name: 'Tentativa',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
          tenantId: contas.b.tenantId,
        });

      expect(resposta.status).toBe(400);
    });

    it('recusa timezone que nao existe', async () => {
      // O ADR-019 faz o bloqueio por inadimplencia depender do timezone da
      // unidade, sem fallback. Timezone invalido gravado hoje vira decisao
      // de acesso errada depois.
      const resposta = await request(servidor())
        .post('/api/v1/units')
        .set('Cookie', contas.a.cookie)
        .send({
          code: `TZ-${sufixo}`,
          name: 'Fuso Errado',
          timezone: 'Marte/Olympus_Mons',
          openingHours: {},
        });

      expect(resposta.status).toBe(400);
    });

    it('grava auditoria e evento na mesma transacao', async () => {
      const code = `AUDIT-${sufixo}`;

      const resposta = await request(servidor())
        .post('/api/v1/units')
        .set('Cookie', contas.a.cookie)
        .send({ code, name: 'Com Trilha', timezone: 'America/Sao_Paulo', openingHours: {} });

      const id = (resposta.body as { id: string }).id;

      // Regra de arquitetura no 5: o evento e persistido na MESMA transacao
      // da mudanca de estado. Publicar antes de commitar produz evento de
      // algo que nunca aconteceu.
      const [trilha, evento] = await Promise.all([
        db.auditLog.findFirst({ where: { tenantId: contas.a.tenantId, targetId: id } }),
        db.outboxEvent.findFirst({ where: { aggregateId: id } }),
      ]);

      expect(trilha?.action).toBe('unit.created');
      expect(evento?.eventType).toBe('GymUnitCreated');
      expect(evento?.publishedAt).toBeNull();
    });
  });

  describe('rotas protegidas', () => {
    it('recusam requisicao sem credencial', async () => {
      // Uma de cada vez: montar as tres antes de aguardar deixa o supertest
      // com sockets abertos que o Jest derruba entre elas.
      expect((await request(servidor()).get('/api/v1/units')).status).toBe(401);
      expect((await request(servidor()).post('/api/v1/units').send({})).status).toBe(401);
      expect(
        (await request(servidor()).patch(`/api/v1/units/${contas.a.unidadeId}`).send({})).status,
      ).toBe(401);
    });

    it('recusam quem nao tem a permissao exigida', async () => {
      const senhas = app.get(PasswordService);
      const email = `recepcao-${sufixo}@exemplo.test`;

      // Usuario do tenant A, com vinculo mas SEM papel: autenticado e
      // legitimo, so nao autorizado. E o caso que separa autenticacao de
      // autorizacao.
      const user = await db.user.create({
        data: { email, passwordHash: await senhas.gerarHash(SENHA) },
      });
      await db.tenantMembership.create({ data: { tenantId: contas.a.tenantId, userId: user.id } });

      const login = await request(servidor())
        .post('/api/v1/auth/login')
        .send({ email, password: SENHA });

      const resposta = await request(servidor())
        .post('/api/v1/units')
        .set('Cookie', cookieDeAcesso(login))
        .send({
          code: `SEM-PERM-${sufixo}`,
          name: 'Sem Permissao',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        });

      expect(resposta.status).toBe(403);
    });
  });
});
