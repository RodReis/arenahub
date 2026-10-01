import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CABECALHOS, assinar } from '@arenahub/api-contracts';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { EdgeAuthService } from '../../src/modules/edge-auth/edge-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * #488 -- leitor cadastrado SEM Edge, Arena Positiva, 01/10/2026.
 *
 * Os leitores foram cadastrados ha semanas, antes de o Edge existir, entao
 * ficaram com `edgeNodeId` nulo. Toda rota do Edge que acha o leitor pelo
 * serial exige o dispositivo no escopo da assinatura (tenant, unidade E
 * Edge) -- e nada no produto permite ligar o dispositivo a um Edge depois
 * de criado. Resultado em campo: vinculo dos alunos com 404 e todo
 * reconhecimento negado como `NO_ENTITLEMENT`, sem aluno identificado.
 *
 * Correcao: o Edge que apresenta o serial de um dispositivo SEM DONO, da
 * PROPRIA unidade, passa a ser o dono dele. O que este arquivo defende e o
 * limite dessa regra -- ela nao pode virar um jeito de um Edge pegar o que
 * nao e dele (regra de arquitetura no 2).
 */
describe('#488 -- Edge reivindica o dispositivo sem dono, so da propria unidade', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);

  const ctx = {
    tenantId: '',
    gymUnitId: '',
    outraUnidadeId: '',
    edgeNodeId: '',
    outroEdgeId: '',
    keyId: '',
    segredo: '',
  };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const comoEdge = (caminho: string, corpo: Record<string, unknown>): Promise<request.Response> => {
    const texto = JSON.stringify(corpo);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(16).toString('base64url');
    const assinatura = assinar(
      { keyId: ctx.keyId, timestamp, nonce, method: 'POST', pathAndQuery: caminho, body: texto },
      ctx.segredo,
    );

    return request(servidor())
      .post(caminho)
      .set(CABECALHOS.keyId, ctx.keyId)
      .set(CABECALHOS.timestamp, String(timestamp))
      .set(CABECALHOS.nonce, nonce)
      .set(CABECALHOS.signature, assinatura)
      .set('Content-Type', 'application/json')
      .send(texto);
  };

  const vincular = (serial: string) =>
    comoEdge('/api/v1/edge/device-users/legacy-links', {
      deviceSerial: serial,
      externalUserIds: ['4242'],
    });

  const decidir = (serial: string) =>
    comoEdge('/api/v1/edge/access-decisions', {
      deviceSerial: serial,
      externalUserId: '4242',
      recognitionId: `rec-${randomUUID()}`,
      recognizedAt: new Date().toISOString(),
      idempotencyKey: `idem-${randomUUID()}`,
    });

  const passagemOffline = (serial: string) =>
    comoEdge('/api/v1/edge/offline-passages', {
      deviceSerial: serial,
      externalUserId: '4242',
      recognitionId: `rec-${randomUUID()}`,
      occurredAt: '2026-09-30T10:00:00.000Z',
      idempotencyKey: `idem-${randomUUID()}`,
    });

  const criarLeitor = (
    rotulo: string,
    dono: { tenantId?: string; gymUnitId?: string; edgeNodeId: string | null },
  ) =>
    db.device.create({
      data: {
        tenantId: dono.tenantId ?? ctx.tenantId,
        gymUnitId: dono.gymUnitId ?? ctx.gymUnitId,
        edgeNodeId: dono.edgeNodeId,
        kind: 'FACIAL_READER',
        model: 'AiFace',
        serial: `SER-CLM-${rotulo}-${sufixo}`,
      },
    });

  const edgeDoLeitor = async (id: string) =>
    (await db.device.findUniqueOrThrow({ where: { id } })).edgeNodeId;

  const auditoriasDaReivindicacao = (deviceId: string) =>
    db.auditLog.count({
      where: { tenantId: ctx.tenantId, action: 'device.claimed_by_edge', targetId: deviceId },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: { slug: `clm-${sufixo}`, legalName: 'Claim LTDA', displayName: 'Claim' },
    });
    ctx.tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'CENTRO',
        name: 'Centro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    ctx.gymUnitId = unidade.id;

    const outraUnidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'BAIRRO',
        name: 'Bairro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    ctx.outraUnidadeId = outraUnidade.id;

    const node = await db.edgeNode.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `EDGE-CLM-${sufixo}` },
    });
    ctx.edgeNodeId = node.id;

    // Um SEGUNDO Edge na mesma unidade: dono de leitor que o primeiro nao pode tomar.
    const outroNode = await db.edgeNode.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `EDGE-CLM-2-${sufixo}` },
    });
    ctx.outroEdgeId = outroNode.id;

    ctx.segredo = randomBytes(32).toString('base64url');
    ctx.keyId = `key-clm-${sufixo}`;

    await db.edgeCredential.create({
      data: {
        tenantId: tenant.id,
        edgeNodeId: node.id,
        keyId: ctx.keyId,
        encryptedSecret: app.get(EdgeAuthService).cifrarSegredo(ctx.segredo),
        activeFrom: new Date(Date.now() - 60_000),
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('o Edge assume o dispositivo sem dono da propria unidade', () => {
    it('no vinculo da base do leitor (legacy-links)', async () => {
      const leitor = await criarLeitor('vinculo', { edgeNodeId: null });

      const resposta = await vincular(leitor.serial);

      expect(resposta.status).toBe(201);
      expect(await edgeDoLeitor(leitor.id)).toBe(ctx.edgeNodeId);
    });

    it('na decisao de acesso -- o evento fica no dispositivo certo, nao sem leitor', async () => {
      const leitor = await criarLeitor('decisao', { edgeNodeId: null });

      const resposta = await decidir(leitor.serial);

      expect(resposta.status).toBe(201);
      expect(await edgeDoLeitor(leitor.id)).toBe(ctx.edgeNodeId);

      const { accessEventId } = resposta.body as { accessEventId: string };
      const evento = await db.accessEvent.findUniqueOrThrow({ where: { id: accessEventId } });
      // Antes da correcao: DEVICE_NOT_IN_SCOPE, evento sem `deviceId`.
      expect(evento.deviceId).toBe(leitor.id);
    });

    it('na passagem offline', async () => {
      const leitor = await criarLeitor('offline', { edgeNodeId: null });

      const resposta = await passagemOffline(leitor.serial);

      expect(resposta.status).toBe(201);
      expect(await edgeDoLeitor(leitor.id)).toBe(ctx.edgeNodeId);
    });

    it('audita a reivindicacao com ator SYSTEM, uma vez so', async () => {
      const leitor = await criarLeitor('auditoria', { edgeNodeId: null });

      await vincular(leitor.serial);
      await vincular(leitor.serial);

      expect(await auditoriasDaReivindicacao(leitor.id)).toBe(1);

      const registro = await db.auditLog.findFirstOrThrow({
        where: { tenantId: ctx.tenantId, action: 'device.claimed_by_edge', targetId: leitor.id },
      });
      expect(registro.actorType).toBe('SYSTEM');
      expect(registro.actorId).toBeNull();
    });

    it('dispositivo que ja e deste Edge segue funcionando, sem auditar de novo', async () => {
      const leitor = await criarLeitor('proprio', { edgeNodeId: ctx.edgeNodeId });

      const resposta = await vincular(leitor.serial);

      expect(resposta.status).toBe(201);
      expect(await auditoriasDaReivindicacao(leitor.id)).toBe(0);
    });
  });

  describe('o que o Edge NAO pode tomar (regra de arquitetura no 2)', () => {
    it('dispositivo que ja tem OUTRO Edge, mesmo na mesma unidade', async () => {
      const leitor = await criarLeitor('alheio', { edgeNodeId: ctx.outroEdgeId });

      const resposta = await vincular(leitor.serial);

      expect(resposta.status).toBe(404);
      expect(await edgeDoLeitor(leitor.id)).toBe(ctx.outroEdgeId);
      expect(await auditoriasDaReivindicacao(leitor.id)).toBe(0);
    });

    it('dispositivo sem dono de OUTRA unidade do mesmo tenant', async () => {
      const leitor = await criarLeitor('outra-unidade', {
        gymUnitId: ctx.outraUnidadeId,
        edgeNodeId: null,
      });

      const resposta = await decidir(leitor.serial);

      // A decisao devolve 201 com DENY (identidade nao resolve); o que importa
      // e que o dispositivo continua sem dono.
      expect(resposta.status).toBe(201);
      expect(await edgeDoLeitor(leitor.id)).toBeNull();
      expect(await auditoriasDaReivindicacao(leitor.id)).toBe(0);
    });

    it('dispositivo sem dono de OUTRO tenant, com o serial que o Edge conhece', async () => {
      const outro = await db.tenant.create({
        data: { slug: `clm-viz-${sufixo}`, legalName: 'Vizinho LTDA', displayName: 'Vizinho' },
      });
      const unidadeVizinha = await db.gymUnit.create({
        data: {
          tenantId: outro.id,
          code: 'CENTRO',
          name: 'Centro',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        },
      });
      const leitor = await db.device.create({
        data: {
          tenantId: outro.id,
          gymUnitId: unidadeVizinha.id,
          edgeNodeId: null,
          kind: 'FACIAL_READER',
          model: 'AiFace',
          serial: `SER-CLM-viz-${sufixo}`,
        },
      });

      const resposta = await passagemOffline(leitor.serial);

      expect(resposta.status).toBe(404);
      expect(await edgeDoLeitor(leitor.id)).toBeNull();
    });
  });
});
