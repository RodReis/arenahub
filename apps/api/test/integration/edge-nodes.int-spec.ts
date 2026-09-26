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
  });

  afterAll(async () => {
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

  it('permite gerar codigo de pareamento para o EdgeNode recem-criado', async () => {
    const criacao = await request(servidor())
      .post('/api/v1/edge-nodes')
      .set('Cookie', cookieDoPainel)
      .send({ gymUnitId, code: `EDGE-PAREAR-${sufixo}` })
      .expect(201);

    const edgeNodeId = (criacao.body as { id: string }).id;

    await request(servidor())
      .post(`/api/v1/edge-nodes/${edgeNodeId}/pairing-codes`)
      .set('Cookie', cookieDoPainel)
      .expect(201);
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

  it('recusa sem sessao autenticada', async () => {
    await request(servidor())
      .post('/api/v1/edge-nodes')
      .send({ gymUnitId, code: `EDGE-SEM-SESSAO-${sufixo}` })
      .expect(401);
  });
});
