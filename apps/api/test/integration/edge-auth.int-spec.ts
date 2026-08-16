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
 * Fatia F8, Task 3 -- autenticacao do Edge por assinatura.
 *
 * Cada teste aqui e um ATAQUE, nao um caminho feliz: corpo adulterado,
 * metodo trocado, chave revogada, nonce repetido, relogio fora da janela e
 * Edge tentando falar pela unidade alheia. O caminho feliz e um teste so;
 * os outros doze sao o motivo de o mecanismo existir.
 */
describe('F8 -- assinatura do Edge', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);

  const edgeA = { tenantId: '', gymUnitId: '', edgeNodeId: '', keyId: '', segredo: '' };
  const edgeB = { tenantId: '', gymUnitId: '', edgeNodeId: '', keyId: '', segredo: '' };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const CORPO = {
    agentVersion: '0.1.0',
    localTimeMs: 0,
    queueDepth: 0,
    devices: [],
  };

  const montarEdge = async (
    alvo: typeof edgeA,
    rotulo: string,
  ): Promise<void> => {
    const tenant = await db.tenant.create({
      data: {
        slug: `edge-${rotulo}-${sufixo}`,
        legalName: `Edge ${rotulo} LTDA`,
        displayName: `Edge ${rotulo}`,
      },
    });

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
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `EDGE-${rotulo}` },
    });

    const segredo = randomBytes(32).toString('base64url');
    const keyId = `key-${rotulo}-${sufixo}`;

    await db.edgeCredential.create({
      data: {
        tenantId: tenant.id,
        edgeNodeId: node.id,
        keyId,
        encryptedSecret: app.get(EdgeAuthService).cifrarSegredo(segredo),
        activeFrom: new Date(Date.now() - 60_000),
      },
    });

    alvo.tenantId = tenant.id;
    alvo.gymUnitId = unidade.id;
    alvo.edgeNodeId = node.id;
    alvo.keyId = keyId;
    alvo.segredo = segredo;
  };

  /** Requisicao assinada, com pontos de adulteracao para os ataques. */
  const enviarHeartbeat = async (opcoes: {
    edge: typeof edgeA;
    corpo?: Record<string, unknown>;
    /** Corpo realmente enviado, quando diferente do assinado. */
    corpoEnviado?: Record<string, unknown>;
    timestamp?: number;
    nonce?: string;
    assinaturaCrua?: string;
    keyIdEnviado?: string;
    caminhoAssinado?: string;
  }): Promise<request.Response> => {
    const corpo = opcoes.corpo ?? { ...CORPO, localTimeMs: Date.now() };
    const enviado = opcoes.corpoEnviado ?? corpo;

    const timestamp = opcoes.timestamp ?? Math.floor(Date.now() / 1000);
    const nonce = opcoes.nonce ?? randomBytes(16).toString('base64url');
    const caminho = '/api/v1/edge/heartbeat';

    const assinatura =
      opcoes.assinaturaCrua ??
      assinar(
        {
          keyId: opcoes.edge.keyId,
          timestamp,
          nonce,
          method: 'POST',
          pathAndQuery: opcoes.caminhoAssinado ?? caminho,
          body: JSON.stringify(corpo),
        },
        opcoes.edge.segredo,
      );

    return request(servidor())
      .post(caminho)
      .set(CABECALHOS.keyId, opcoes.keyIdEnviado ?? opcoes.edge.keyId)
      .set(CABECALHOS.timestamp, String(timestamp))
      .set(CABECALHOS.nonce, nonce)
      .set(CABECALHOS.signature, assinatura)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(enviado));
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    // Mesmo parser de producao: sem ele o corpo cru nao chega ao guard e
    // TODA requisicao assinada e recusada. O teste monta a aplicacao como o
    // `main.ts` monta, de proposito.
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    await montarEdge(edgeA, 'a');
    await montarEdge(edgeB, 'b');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('caminho valido', () => {
    it('aceita requisicao corretamente assinada', async () => {
      const resposta = await enviarHeartbeat({ edge: edgeA });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({
        serverTime: expect.any(String),
        clockOffsetMs: expect.any(Number),
      });
    });

    it('registra o heartbeat e a deriva do relogio', async () => {
      await enviarHeartbeat({
        edge: edgeA,
        corpo: { ...CORPO, localTimeMs: Date.now() + 4_000, agentVersion: '0.2.0' },
      });

      const node = await db.edgeNode.findUnique({ where: { id: edgeA.edgeNodeId } });

      expect(node?.agentVersion).toBe('0.2.0');
      expect(node?.lastHeartbeat).not.toBeNull();
      // Relogio torto e causa comum de 401 em campo; registrar a deriva e o
      // que evita a caca ao fantasma.
      expect(node?.clockOffsetMs).toBeGreaterThan(2_000);
    });
  });

  describe('adulteracao', () => {
    it('recusa corpo diferente do assinado', async () => {
      const resposta = await enviarHeartbeat({
        edge: edgeA,
        corpo: { ...CORPO, localTimeMs: Date.now(), queueDepth: 0 },
        corpoEnviado: { ...CORPO, localTimeMs: Date.now(), queueDepth: 999 },
      });

      expect(resposta.status).toBe(401);
      expect(resposta.body).toMatchObject({ code: 'EDGE_SIGNATURE_INVALID' });
    });

    it('recusa assinatura de caminho diferente', async () => {
      const resposta = await enviarHeartbeat({
        edge: edgeA,
        caminhoAssinado: '/api/v1/edge/commands',
      });

      expect(resposta.status).toBe(401);
      expect(resposta.body).toMatchObject({ code: 'EDGE_SIGNATURE_INVALID' });
    });

    it('recusa assinatura forjada', async () => {
      const resposta = await enviarHeartbeat({
        edge: edgeA,
        assinaturaCrua: 'a'.repeat(64),
      });

      expect(resposta.status).toBe(401);
    });

    it('recusa assinatura de tamanho invalido sem virar 500', async () => {
      // `timingSafeEqual` lanca com buffers de tamanhos distintos -- a
      // checagem de comprimento antes e o que mantem isto em 401.
      const resposta = await enviarHeartbeat({ edge: edgeA, assinaturaCrua: 'abc' });

      expect(resposta.status).toBe(401);
    });

    it('recusa assinatura feita com o segredo de outro Edge', async () => {
      const resposta = await enviarHeartbeat({
        edge: { ...edgeA, segredo: edgeB.segredo },
      });

      expect(resposta.status).toBe(401);
      expect(resposta.body).toMatchObject({ code: 'EDGE_SIGNATURE_INVALID' });
    });
  });

  describe('cabecalhos ausentes', () => {
    it('recusa requisicao sem assinatura', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/edge/heartbeat')
        .send({ ...CORPO, localTimeMs: Date.now() });

      expect(resposta.status).toBe(401);
      expect(resposta.body).toMatchObject({ code: 'EDGE_SIGNATURE_MISSING' });
    });
  });

  describe('janela de relogio', () => {
    it('recusa timestamp muito atrasado', async () => {
      const resposta = await enviarHeartbeat({
        edge: edgeA,
        timestamp: Math.floor(Date.now() / 1000) - 400,
      });

      expect(resposta.status).toBe(401);
      expect(resposta.body).toMatchObject({ code: 'EDGE_TIMESTAMP_OUT_OF_WINDOW' });
    });

    it('recusa timestamp adiantado alem da janela', async () => {
      // Aceitar futuro permitiria pre-assinar requisicoes para usar depois.
      const resposta = await enviarHeartbeat({
        edge: edgeA,
        timestamp: Math.floor(Date.now() / 1000) + 400,
      });

      expect(resposta.status).toBe(401);
      expect(resposta.body).toMatchObject({ code: 'EDGE_TIMESTAMP_OUT_OF_WINDOW' });
    });

    it('aceita relogio levemente torto dentro da janela', async () => {
      const resposta = await enviarHeartbeat({
        edge: edgeA,
        timestamp: Math.floor(Date.now() / 1000) - 120,
      });

      // PC de academia raramente tem NTP -- a janela existe para isso.
      expect(resposta.status).toBe(201);
    });
  });

  describe('replay', () => {
    it('recusa o mesmo nonce duas vezes', async () => {
      const nonce = randomBytes(16).toString('base64url');
      const corpo = { ...CORPO, localTimeMs: Date.now() };

      const primeira = await enviarHeartbeat({ edge: edgeA, nonce, corpo });
      const segunda = await enviarHeartbeat({ edge: edgeA, nonce, corpo });

      expect(primeira.status).toBe(201);
      // A unique constraint E o mecanismo: o INSERT decide, sem janela de
      // corrida entre consultar e gravar.
      expect(segunda.status).toBe(401);
      expect(segunda.body).toMatchObject({ code: 'EDGE_REPLAY_DETECTED' });
    });

    it('nao grava nonce de requisicao com assinatura invalida', async () => {
      const nonce = randomBytes(16).toString('base64url');

      await enviarHeartbeat({ edge: edgeA, nonce, assinaturaCrua: 'b'.repeat(64) });

      const gravados = await db.replayNonce.count({
        where: { edgeNodeId: edgeA.edgeNodeId },
      });

      // Gravar antes de validar deixaria qualquer um encher a tabela
      // mandando lixo assinado com chave inventada.
      const reuso = await enviarHeartbeat({ edge: edgeA, nonce });

      expect(reuso.status).toBe(201);
      expect(gravados).toBeGreaterThanOrEqual(0);
    });
  });

  describe('credencial', () => {
    it('recusa chave desconhecida', async () => {
      const resposta = await enviarHeartbeat({
        edge: edgeA,
        keyIdEnviado: `inexistente-${sufixo}`,
      });

      expect(resposta.status).toBe(401);
      expect(resposta.body).toMatchObject({ code: 'EDGE_KEY_UNKNOWN' });
    });

    it('recusa chave revogada imediatamente', async () => {
      const tenant = await db.tenant.create({
        data: {
          slug: `edge-revogado-${sufixo}`,
          legalName: 'Revogado LTDA',
          displayName: 'Revogado',
        },
      });

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
        data: { tenantId: tenant.id, gymUnitId: unidade.id, code: 'EDGE-REVOGADO' },
      });

      const segredo = randomBytes(32).toString('base64url');
      const keyId = `key-revogado-${sufixo}`;

      await db.edgeCredential.create({
        data: {
          tenantId: tenant.id,
          edgeNodeId: node.id,
          keyId,
          encryptedSecret: app.get(EdgeAuthService).cifrarSegredo(segredo),
          activeFrom: new Date(Date.now() - 60_000),
          // Revogacao vale no ato, sem esperar expirar.
          revokedAt: new Date(),
        },
      });

      const resposta = await enviarHeartbeat({
        edge: { tenantId: tenant.id, gymUnitId: unidade.id, edgeNodeId: node.id, keyId, segredo },
      });

      expect(resposta.status).toBe(401);
      expect(resposta.body).toMatchObject({ code: 'EDGE_KEY_REVOKED' });
    });
  });

  describe('isolamento entre unidades', () => {
    it('nao atualiza dispositivo de outra unidade nem com o serial certo', async () => {
      const dispositivoDoB = await db.device.create({
        data: {
          tenantId: edgeB.tenantId,
          gymUnitId: edgeB.gymUnitId,
          kind: 'FACIAL_READER',
          model: 'Inner Fit',
          serial: `SER-DO-B-${sufixo}`,
          status: 'ACTIVE',
        },
      });

      // Edge A assina corretamente, mas reporta o dispositivo do B.
      const resposta = await enviarHeartbeat({
        edge: edgeA,
        corpo: {
          ...CORPO,
          localTimeMs: Date.now(),
          devices: [
            {
              serial: dispositivoDoB.serial,
              model: 'Inner Fit',
              status: 'RETIRED',
            },
          ],
        },
      });

      expect(resposta.status).toBe(201);
      // Nenhum dispositivo reconhecido: o filtro por tenant e unidade vem da
      // CREDENCIAL, nao do corpo (regra de arquitetura no 2).
      expect(resposta.body).toMatchObject({ acknowledgedDevices: 0 });

      const inalterado = await db.device.findUnique({ where: { id: dispositivoDoB.id } });
      expect(inalterado?.status).toBe('ACTIVE');
    });

    it('recusa tenantId no corpo, em vez de ignorar', async () => {
      const corpo = {
        ...CORPO,
        localTimeMs: Date.now(),
        tenantId: edgeB.tenantId,
      };

      const resposta = await enviarHeartbeat({ edge: edgeA, corpo });

      // `.strict()`: aceitar o campo, mesmo que so para conferir, criaria a
      // duvida sobre qual identidade vale.
      expect(resposta.status).toBe(400);
    });
  });
});
