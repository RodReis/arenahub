import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Issue #404 -- ate aqui, `POST /api/v1/edge-nodes/:id/pairing-codes` exigia
 * um `EdgeNode` ja existente, mas nao havia como cria-lo: nem endpoint, nem
 * tela. A instalacao real do edge-agent na Arena Positiva (26/09/2026) travou
 * exatamente aqui -- este teste cobre o endpoint que fecha a lacuna.
 */
const SENHA_DO_PAINEL = 'SenhaForte#2026';

describe('POST /api/v1/edge-nodes', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);

  let tenantId: string;
  let gymUnitId: string;
  let unidadeInativaId: string;
  let outroTenantId: string;
  let unidadeDeOutroTenantId: string;
  let cookieDoPainel = '';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `f404-edge-node-${sufixo}`,
        legalName: 'Edge Node LTDA',
        displayName: 'Edge Node',
      },
    });

    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'CENTRO',
        name: 'Centro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    gymUnitId = unidade.id;

    const inativa = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'FECHADA',
        name: 'Fechada',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
        status: 'INACTIVE',
      },
    });

    unidadeInativaId = inativa.id;

    const email = `admin-edge-node-${sufixo}@arenahub.test`;

    const usuario = await db.user.create({
      data: { email, passwordHash: await app.get(PasswordService).gerarHash(SENHA_DO_PAINEL) },
    });

    await db.tenantMembership.create({ data: { tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId, name: 'ADMIN DE EDGE', isSystem: false },
    });

    const permissao = await db.permission.upsert({
      where: { code: 'device.manage' },
      create: { code: 'device.manage' },
      update: {},
    });

    await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    await db.userRole.create({ data: { tenantId, userId: usuario.id, roleId: papel.id } });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email, password: SENHA_DO_PAINEL });

    const cabecalho: unknown = login.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    cookieDoPainel = lista.find((c) => c.startsWith('arenahub_access=')) ?? '';

    // Segundo tenant, so para provar isolamento (regra de arquitetura no 2).
    const outroTenant = await db.tenant.create({
      data: {
        slug: `f404-outro-${sufixo}`,
        legalName: 'Outro Tenant LTDA',
        displayName: 'Outro Tenant',
      },
    });

    outroTenantId = outroTenant.id;

    const unidadeAlheia = await db.gymUnit.create({
      data: {
        tenantId: outroTenant.id,
        code: 'CENTRO-2',
        name: 'Centro 2',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    unidadeDeOutroTenantId = unidadeAlheia.id;
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: outroTenantId } });
    await db.tenant.delete({ where: { id: tenantId } });
    await app?.close();
  });

  it('cria um EdgeNode e o retorna com status ACTIVE', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/edge-nodes')
      .set('Cookie', cookieDoPainel)
      .send({ gymUnitId, code: `EDGE-NOVO-${sufixo}` })
      .expect(201);

    expect(resposta.body).toMatchObject({
      id: expect.any(String),
      gymUnitId,
      code: `EDGE-NOVO-${sufixo}`,
      status: 'ACTIVE',
    });

    const criado = await db.edgeNode.findUnique({
      where: { id: (resposta.body as { id: string }).id },
    });

    expect(criado).not.toBeNull();
    expect(criado?.tenantId).toBe(tenantId);
  });

  /**
   * A CADEIA INTEIRA, sem contornar nenhum endpoint -- que e o vicio que a
   * issue #404 apontou no `edge-pairing.int-spec.ts`, onde o `EdgeNode`
   * nascia direto via Prisma porque nao havia rota para cria-lo.
   */
  it('cadastra, gera codigo com validade e o pair aceita esse codigo', async () => {
    const criacao = await request(servidor())
      .post('/api/v1/edge-nodes')
      .set('Cookie', cookieDoPainel)
      .send({ gymUnitId, code: `EDGE-PAREAR-${sufixo}` })
      .expect(201);

    const edgeNodeId = (criacao.body as { id: string }).id;

    const geracao = await request(servidor())
      .post(`/api/v1/edge-nodes/${edgeNodeId}/pairing-codes`)
      .set('Cookie', cookieDoPainel)
      .expect(201);

    // O painel MOSTRA a validade ao operador (ADR-011, TTL curto): sem
    // `expiresAt` no corpo, a tela nao teria o que exibir.
    expect(geracao.body).toEqual({ code: expect.any(String), expiresAt: expect.any(String) });
    expect(new Date((geracao.body as { expiresAt: string }).expiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );

    await request(servidor())
      .post('/api/v1/edge/pair')
      .send({ code: (geracao.body as { code: string }).code })
      .expect(201);
  });

  /**
   * INV-006 -- `EdgeNode.gymUnitId` NAO tem FK no schema, entao o banco nao
   * barra: sem a checagem do caso de uso, o tenant A criaria um Edge
   * apontando para a instalacao FISICA do tenant B.
   */
  it('recusa gymUnitId de outro tenant com o mesmo 404 de inexistente', async () => {
    const alheia = await request(servidor())
      .post('/api/v1/edge-nodes')
      .set('Cookie', cookieDoPainel)
      .send({ gymUnitId: unidadeDeOutroTenantId, code: `EDGE-ALHEIO-${sufixo}` })
      .expect(404);

    const inexistente = await request(servidor())
      .post('/api/v1/edge-nodes')
      .set('Cookie', cookieDoPainel)
      .send({ gymUnitId: randomUUID(), code: `EDGE-FANTASMA-${sufixo}` })
      .expect(404);

    // A recusa nunca distingue "nao existe" de "e de outro tenant" --
    // distinguir confirmaria ao atacante que ele acertou o UUID.
    expect(alheia.body).toMatchObject({ code: 'GYM_UNIT_NOT_FOUND' });
    expect(inexistente.body).toMatchObject({ code: 'GYM_UNIT_NOT_FOUND' });

    const criado = await db.edgeNode.findFirst({
      where: { gymUnitId: unidadeDeOutroTenantId },
    });

    expect(criado).toBeNull();
  });

  it('recusa unidade inativa', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/edge-nodes')
      .set('Cookie', cookieDoPainel)
      .send({ gymUnitId: unidadeInativaId, code: `EDGE-INATIVA-${sufixo}` })
      .expect(400);

    expect(resposta.body).toMatchObject({ code: 'GYM_UNIT_NOT_ACTIVE' });
  });

  it('recusa codigo duplicado no mesmo tenant com 409', async () => {
    const codigo = `EDGE-DUPLICADO-${sufixo}`;

    await request(servidor())
      .post('/api/v1/edge-nodes')
      .set('Cookie', cookieDoPainel)
      .send({ gymUnitId, code: codigo })
      .expect(201);

    await request(servidor())
      .post('/api/v1/edge-nodes')
      .set('Cookie', cookieDoPainel)
      .send({ gymUnitId, code: codigo })
      .expect(409);
  });

  it('recusa corpo sem gymUnitId ou code', async () => {
    await request(servidor())
      .post('/api/v1/edge-nodes')
      .set('Cookie', cookieDoPainel)
      .send({ code: 'SEM-UNIDADE' })
      .expect(400);
  });

  /** O tenant vem da identidade autenticada, nunca do corpo (regra no 2). */
  it('recusa tenantId no corpo', async () => {
    await request(servidor())
      .post('/api/v1/edge-nodes')
      .set('Cookie', cookieDoPainel)
      .send({ gymUnitId, code: `EDGE-TENANT-${sufixo}`, tenantId: outroTenantId })
      .expect(400);
  });

  it('recusa sem sessao autenticada', async () => {
    await request(servidor())
      .post('/api/v1/edge-nodes')
      .send({ gymUnitId, code: `EDGE-SEM-SESSAO-${sufixo}` })
      .expect(401);
  });
});
