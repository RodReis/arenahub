import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
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
