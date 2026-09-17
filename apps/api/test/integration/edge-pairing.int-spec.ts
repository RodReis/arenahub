import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F59, Task 8 -- troca de codigo de pareamento por credencial de Edge.
 *
 * Esta rota e DELIBERADAMENTE diferente das outras do modulo `edge-auth`:
 * ela NAO usa `@EdgeRoute()`/HMAC, porque o agente ainda nao tem credencial
 * neste ponto -- a autenticacao E o proprio codigo de uso unico.
 *
 * A regra de seguranca que todo teste de recusa aqui defende: a mensagem de
 * recusa NUNCA diferencia "nao existe" de "expirado" de "ja usado" -- as
 * quatro situacoes de falha caem no mesmo 409 genérico.
 */
const SENHA_DO_PAINEL = 'SenhaForte#2026';

describe('POST /api/v1/edge/pair', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);

  let tenantId: string;
  let gymUnitId: string;
  let edgeNodeId: string;

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const criarCodigo = async (opcoes: {
    expiresAt: Date;
    usedAt?: Date;
  }): Promise<string> => {
    const codigoEmClaro = randomBytes(24).toString('base64url');
    const hash = createHash('sha256').update(codigoEmClaro).digest('hex');

    await db.edgePairingCode.create({
      data: {
        tenantId,
        gymUnitId,
        edgeNodeId,
        codeHash: hash,
        expiresAt: opcoes.expiresAt,
        usedAt: opcoes.usedAt ?? null,
      },
    });

    return codigoEmClaro;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `f59-pairing-${sufixo}`,
        legalName: 'Pareamento LTDA',
        displayName: 'Pareamento',
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

    const node = await db.edgeNode.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `EDGE-PAIR-${sufixo}` },
    });

    edgeNodeId = node.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('troca um codigo valido por keyId e secret, e marca o codigo como usado', async () => {
    const codigoEmClaro = await criarCodigo({ expiresAt: new Date(Date.now() + 10 * 60_000) });

    const resposta = await request(servidor())
      .post('/api/v1/edge/pair')
      .send({ code: codigoEmClaro })
      .expect(201);

    expect(resposta.body).toEqual({ keyId: expect.any(String), secret: expect.any(String) });

    const credencial = await db.edgeCredential.findUnique({
      where: { keyId: (resposta.body as { keyId: string }).keyId },
    });

    expect(credencial).not.toBeNull();
    expect(credencial?.edgeNodeId).toBe(edgeNodeId);

    const hash = createHash('sha256').update(codigoEmClaro).digest('hex');
    const codigoUsado = await db.edgePairingCode.findFirst({ where: { codeHash: hash } });

    expect(codigoUsado?.usedAt).not.toBeNull();
  });

  it('recusa o mesmo codigo usado duas vezes', async () => {
    const codigoEmClaro = await criarCodigo({ expiresAt: new Date(Date.now() + 10 * 60_000) });

    await request(servidor()).post('/api/v1/edge/pair').send({ code: codigoEmClaro }).expect(201);
    await request(servidor()).post('/api/v1/edge/pair').send({ code: codigoEmClaro }).expect(409);
  });

  it('recusa codigo expirado', async () => {
    const codigoEmClaro = await criarCodigo({ expiresAt: new Date(Date.now() - 1_000) });

    await request(servidor()).post('/api/v1/edge/pair').send({ code: codigoEmClaro }).expect(409);
  });

  it('recusa codigo inexistente com a MESMA resposta de expirado/usado', async () => {
    const respostaInexistente = await request(servidor())
      .post('/api/v1/edge/pair')
      .send({ code: 'codigo-que-nao-existe-12345678' })
      .expect(409);

    const codigoExpirado = await criarCodigo({ expiresAt: new Date(Date.now() - 1_000) });
    const respostaExpirado = await request(servidor())
      .post('/api/v1/edge/pair')
      .send({ code: codigoExpirado })
      .expect(409);

    // A recusa nunca vaza qual dos motivos causou o 409: mesmo code/title/
    // status independente de o codigo nao existir, estar expirado ou ja ter
    // sido usado. `correlationId` fica de fora -- e unico por requisicao por
    // desenho, nao carrega o motivo da recusa.
    expect(respostaInexistente.body).toMatchObject({
      code: 'EDGE_PAIRING_REJECTED',
      title: (respostaExpirado.body as { title: string }).title,
      status: (respostaExpirado.body as { status: number }).status,
    });
    expect(respostaExpirado.body).toMatchObject({ code: 'EDGE_PAIRING_REJECTED' });
  });
});

/**
 * F59, Task 9 -- lado do painel: gerar o codigo que a Task 8 troca por
 * credencial.
 */
describe('POST /api/v1/edge-nodes/:edgeNodeId/pairing-codes', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);

  let tenantId: string;
  let outroTenantId: string;
  let edgeNodeId: string;
  let edgeNodeDeOutroTenant: string;
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
        slug: `f59-gerar-${sufixo}`,
        legalName: 'Gerador de Codigo LTDA',
        displayName: 'Gerador de Codigo',
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

    const node = await db.edgeNode.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `EDGE-GERAR-${sufixo}` },
    });

    edgeNodeId = node.id;

    const email = `admin-gerar-${sufixo}@arenahub.test`;

    const usuario = await db.user.create({
      data: { email, passwordHash: await app.get(PasswordService).gerarHash(SENHA_DO_PAINEL) },
    });

    await db.tenantMembership.create({ data: { tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId, name: 'ADMIN DE PAREAMENTO', isSystem: false },
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
        slug: `f59-gerar-outro-${sufixo}`,
        legalName: 'Outro Tenant LTDA',
        displayName: 'Outro Tenant',
      },
    });

    outroTenantId = outroTenant.id;

    const outraUnidade = await db.gymUnit.create({
      data: {
        tenantId: outroTenant.id,
        code: 'CENTRO-2',
        name: 'Centro 2',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const nodeDeOutroTenant = await db.edgeNode.create({
      data: {
        tenantId: outroTenant.id,
        gymUnitId: outraUnidade.id,
        code: `EDGE-GERAR-OUTRO-${sufixo}`,
      },
    });

    edgeNodeDeOutroTenant = nodeDeOutroTenant.id;
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: outroTenantId } });
    await db.tenant.delete({ where: { id: tenantId } });
    await app?.close();
  });

  it('gera um codigo que o pair aceita', async () => {
    const geracao = await request(servidor())
      .post(`/api/v1/edge-nodes/${edgeNodeId}/pairing-codes`)
      .set('Cookie', cookieDoPainel)
      .expect(201);

    expect(geracao.body).toEqual({ code: expect.any(String), expiresAt: expect.any(String) });

    await request(servidor())
      .post('/api/v1/edge/pair')
      .send({ code: (geracao.body as { code: string }).code })
      .expect(201);
  });

  it('recusa gerar codigo para edgeNode de outro tenant', async () => {
    await request(servidor())
      .post(`/api/v1/edge-nodes/${edgeNodeDeOutroTenant}/pairing-codes`)
      .set('Cookie', cookieDoPainel)
      .expect(404);
  });
});
