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
 * #490 -- a reivindicacao automatica (#488) nao tinha desfazer pelo produto:
 * `PATCH /devices/:id` nao aceitava `edgeNodeId`, e o painel nao tinha o campo.
 *
 * O que estes casos existem para pegar: o Edge novo vir de OUTRA unidade ou de
 * OUTRO tenant (a FK do Postgres aceita os dois), e o desfazer nao deixar rastro.
 */
const SENHA = 'SenhaForte#2026';

describe('#490 -- reatribuir o Edge de um dispositivo', () => {
  let app: INestApplication;
  let db: PrismaService;
  let tenantId = '';
  let outroTenantId = '';
  let unidadeId = '';
  let outraUnidadeId = '';
  let edgeDaUnidadeId = '';
  let outroEdgeDaUnidadeId = '';
  let edgeDeOutraUnidadeId = '';
  let edgeDeOutroTenantId = '';
  let edgeSuspensoId = '';
  let dispositivoId = '';
  let cookie = '';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const patch = (corpo: object) =>
    request(servidor())
      .patch(`/api/v1/devices/${dispositivoId}`)
      .set('Cookie', cookie)
      .send(corpo);

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();
    db = app.get(PrismaService);

    const sufixo = randomUUID().slice(0, 8);

    const tenant = await db.tenant.create({
      data: { slug: `t-${sufixo}`, legalName: `T-${sufixo} LTDA`, displayName: `T-${sufixo}` },
    });
    tenantId = tenant.id;

    const outroTenant = await db.tenant.create({
      data: { slug: `o-${sufixo}`, legalName: `O-${sufixo} LTDA`, displayName: `O-${sufixo}` },
    });
    outroTenantId = outroTenant.id;

    const criarUnidade = (dono: string, code: string) =>
      db.gymUnit.create({
        data: { tenantId: dono, code, name: code, timezone: 'America/Sao_Paulo', openingHours: {} },
      });

    unidadeId = (await criarUnidade(tenantId, `U1-${sufixo}`)).id;
    outraUnidadeId = (await criarUnidade(tenantId, `U2-${sufixo}`)).id;
    await criarUnidade(outroTenantId, `U3-${sufixo}`);

    const criarEdge = async (dono: string, unidade: string, code: string) =>
      (await db.edgeNode.create({ data: { tenantId: dono, gymUnitId: unidade, code } })).id;

    edgeDaUnidadeId = await criarEdge(tenantId, unidadeId, `E1-${sufixo}`);
    outroEdgeDaUnidadeId = await criarEdge(tenantId, unidadeId, `E2-${sufixo}`);
    edgeDeOutraUnidadeId = await criarEdge(tenantId, outraUnidadeId, `E3-${sufixo}`);
    /*
     * `EdgeNode.gymUnitId` nao tem FK: o Edge do OUTRO tenant aponta para a
     * MESMA unidade do dispositivo, de proposito. Assim a recusa so pode vir
     * do filtro de tenant -- tirar `tenantId` do `where` derruba o teste.
     */
    edgeDeOutroTenantId = await criarEdge(outroTenantId, unidadeId, `E4-${sufixo}`);
    edgeSuspensoId = (
      await db.edgeNode.create({
        data: { tenantId, gymUnitId: unidadeId, code: `E5-${sufixo}`, status: 'SUSPENDED' },
      })
    ).id;

    const dispositivo = await db.device.create({
      data: {
        tenantId,
        gymUnitId: unidadeId,
        edgeNodeId: edgeDaUnidadeId,
        kind: 'FACIAL_READER',
        model: 'Topdata Inner Fit',
        serial: `SN-${sufixo}`,
      },
    });
    dispositivoId = dispositivo.id;

    const email = `admin-${sufixo}@arenahub.test`;
    const usuario = await db.user.create({
      data: { email, passwordHash: await app.get(PasswordService).gerarHash(SENHA) },
    });
    await db.tenantMembership.create({ data: { tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId, name: 'ADMIN DE TESTE', isSystem: false },
    });

    for (const codigo of ['device.read', 'device.manage']) {
      const permissao = await db.permission.upsert({
        where: { code: codigo },
        create: { code: codigo },
        update: {},
      });
      await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    }

    await db.userRole.create({ data: { tenantId, userId: usuario.id, roleId: papel.id } });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email, password: SENHA });

    const cabecalho: unknown = login.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    cookie = lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [tenantId, outroTenantId] } } });
    await app.close();
  });

  it('passa o dispositivo para outro Edge da mesma unidade e audita o anterior', async () => {
    const resposta = await patch({ edgeNodeId: outroEdgeDaUnidadeId });

    expect(resposta.status).toBe(200);
    expect((resposta.body as { edgeNodeId: string }).edgeNodeId).toBe(outroEdgeDaUnidadeId);

    const auditoria = await db.auditLog.findFirst({
      where: { tenantId, targetId: dispositivoId, action: 'device.updated' },
      orderBy: { occurredAt: 'desc' },
    });

    expect(auditoria?.actorType).toBe('USER');
    expect(auditoria?.metadata).toMatchObject({
      edgeNodeId: outroEdgeDaUnidadeId,
      edgeNodeAnterior: edgeDaUnidadeId,
    });
  });

  it.each([
    ['de outra unidade do mesmo tenant', () => edgeDeOutraUnidadeId],
    ['de outro tenant', () => edgeDeOutroTenantId],
    ['suspenso', () => edgeSuspensoId],
    ['inexistente', () => randomUUID()],
  ])('recusa Edge %s com EDGE_NODE_NOT_FOUND e nao muda o dono', async (_caso, edge) => {
    const antes = await db.device.findUniqueOrThrow({ where: { id: dispositivoId } });

    const resposta = await patch({ edgeNodeId: edge() });

    expect(resposta.status).toBe(404);
    expect((resposta.body as { code: string }).code).toBe('EDGE_NODE_NOT_FOUND');

    const depois = await db.device.findUniqueOrThrow({ where: { id: dispositivoId } });

    expect(depois.edgeNodeId).toBe(antes.edgeNodeId);
  });

  it('limpa o dono com null e audita o anterior', async () => {
    await patch({ edgeNodeId: edgeDaUnidadeId });

    const resposta = await patch({ edgeNodeId: null });

    expect(resposta.status).toBe(200);
    expect((resposta.body as { edgeNodeId: string | null }).edgeNodeId).toBeNull();

    const auditoria = await db.auditLog.findFirst({
      where: { tenantId, targetId: dispositivoId, action: 'device.updated' },
      orderBy: { occurredAt: 'desc' },
    });

    expect(auditoria?.metadata).toMatchObject({
      edgeNodeId: null,
      edgeNodeAnterior: edgeDaUnidadeId,
    });
  });

  it('aceita reenviar o dono atual mesmo suspenso (editar firmware nao pode falhar)', async () => {
    await db.device.update({ where: { id: dispositivoId }, data: { edgeNodeId: edgeSuspensoId } });

    const resposta = await patch({ edgeNodeId: edgeSuspensoId, firmware: '9.9.9' });

    expect(resposta.status).toBe(200);
    expect((resposta.body as { edgeNodeId: string }).edgeNodeId).toBe(edgeSuspensoId);
  });

  it('nao mexe no dono quando o corpo nao traz edgeNodeId', async () => {
    await patch({ edgeNodeId: edgeDaUnidadeId });

    const resposta = await patch({ firmware: '1.2.3' });

    expect(resposta.status).toBe(200);
    expect((resposta.body as { edgeNodeId: string }).edgeNodeId).toBe(edgeDaUnidadeId);
  });

  it('lista so os Edges do tenant, filtrados por unidade', async () => {
    const resposta = await request(servidor())
      .get(`/api/v1/edge-nodes?gymUnitId=${unidadeId}`)
      .set('Cookie', cookie);

    expect(resposta.status).toBe(200);

    const ids = (resposta.body as { id: string }[]).map((e) => e.id).sort();

    expect(ids).toEqual([edgeDaUnidadeId, outroEdgeDaUnidadeId, edgeSuspensoId].sort());
  });

  it('nao lista Edge de outro tenant nem sem filtro de unidade', async () => {
    const resposta = await request(servidor()).get('/api/v1/edge-nodes').set('Cookie', cookie);

    const ids = (resposta.body as { id: string }[]).map((e) => e.id);

    expect(ids).not.toContain(edgeDeOutroTenantId);
    expect(ids).toContain(edgeDeOutraUnidadeId);
  });

  /**
   * #586 -- `POST /devices` gravava `gymUnitId` e `edgeNodeId` do corpo sem
   * conferir o tenant (a FK so prova que a linha existe), ao contrario do PATCH.
   */
  describe('cadastro de dispositivo confere unidade e Edge do tenant', () => {
    const criar = (corpo: object) =>
      request(servidor()).post('/api/v1/devices').set('Cookie', cookie).send(corpo);

    const corpoBase = () => ({
      kind: 'FACIAL_READER',
      model: 'Inner Fit',
      serial: `SN-NOVO-${randomUUID().slice(0, 8)}`,
    });

    it('cadastra com unidade e Edge do proprio tenant', async () => {
      const resposta = await criar({
        ...corpoBase(),
        gymUnitId: unidadeId,
        edgeNodeId: edgeDaUnidadeId,
      });

      expect(resposta.status).toBe(201);
    });

    it('recusa unidade de OUTRO tenant e nao grava nada', async () => {
      const unidadeDeOutro = await db.gymUnit.findFirstOrThrow({
        where: { tenantId: outroTenantId },
      });
      const corpo = { ...corpoBase(), gymUnitId: unidadeDeOutro.id };

      const resposta = await criar(corpo);

      expect(resposta.status).toBe(404);
      expect(resposta.body).toMatchObject({ code: 'GYM_UNIT_NOT_FOUND' });
      expect(await db.device.count({ where: { serial: corpo.serial } })).toBe(0);
    });

    it('recusa Edge de OUTRO tenant, mesmo apontando para a mesma unidade', async () => {
      const corpo = { ...corpoBase(), gymUnitId: unidadeId, edgeNodeId: edgeDeOutroTenantId };

      const resposta = await criar(corpo);

      expect(resposta.status).toBe(404);
      expect(resposta.body).toMatchObject({ code: 'EDGE_NODE_NOT_FOUND' });
      expect(await db.device.count({ where: { serial: corpo.serial } })).toBe(0);
    });

    it('recusa Edge de outra unidade do mesmo tenant', async () => {
      const resposta = await criar({
        ...corpoBase(),
        gymUnitId: unidadeId,
        edgeNodeId: edgeDeOutraUnidadeId,
      });

      expect(resposta.status).toBe(404);
    });
  });
});
