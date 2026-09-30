import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { POLICY_VERSION } from '@arenahub/access-policy';
import { CABECALHOS, assinar } from '@arenahub/api-contracts';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { EdgeAuthService } from '../../src/modules/edge-auth/edge-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * #477 -- registro das passagens que o leitor guardou offline.
 *
 * Decisao do PI (30/09/2026): o backlog que o leitor acumula enquanto o
 * ArenaHub esta fora CONTA COMO FREQUENCIA. A catraca ja decidiu (o
 * equipamento liberou sozinho, em modo offline) -- o ArenaHub so REGISTRA o
 * fato, nunca avalia. `ehPassagemAoVivo` (#476) e quem impede o Edge de
 * pedir decisao para backlog; aqui e o outro lado, o registro em si.
 *
 * O que este arquivo defende:
 *   - vira ALLOW / OFFLINE_DEVICE_DECISION, nunca passa pelo motor;
 *   - idempotente pelo id do registro do leitor (regra de arquitetura no 4);
 *   - o horario gravado e o do EQUIPAMENTO, nao o do recebimento;
 *   - so registra dentro do escopo do Edge que assinou.
 */
describe('#477 -- passagem offline', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);

  const ctx = {
    tenantId: '',
    gymUnitId: '',
    edgeNodeId: '',
    deviceId: '',
    studentId: '',
    keyId: '',
    segredo: '',
    externalUserId: '1491',
  };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const comoEdge = async (
    caminho: string,
    corpo: Record<string, unknown>,
  ): Promise<request.Response> => {
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

  const registrar = (sobrescreve: Record<string, unknown> = {}): Promise<request.Response> =>
    comoEdge('/api/v1/edge/offline-passages', {
      deviceSerial: 'SER-OFF',
      externalUserId: ctx.externalUserId,
      recognitionId: `rec-off-${randomUUID()}`,
      occurredAt: '2026-09-30T10:00:00.000Z',
      idempotencyKey: `idem-off-${randomUUID()}`,
      ...sobrescreve,
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: { slug: `off-${sufixo}`, legalName: 'Offline LTDA', displayName: 'Offline' },
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

    const node = await db.edgeNode.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `EDGE-OFF-${sufixo}` },
    });
    ctx.edgeNodeId = node.id;

    ctx.segredo = randomBytes(32).toString('base64url');
    ctx.keyId = `key-off-${sufixo}`;

    await db.edgeCredential.create({
      data: {
        tenantId: tenant.id,
        edgeNodeId: node.id,
        keyId: ctx.keyId,
        encryptedSecret: app.get(EdgeAuthService).cifrarSegredo(ctx.segredo),
        activeFrom: new Date(Date.now() - 60_000),
      },
    });

    const leitor = await db.device.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        edgeNodeId: node.id,
        kind: 'FACIAL_READER',
        model: 'AiFace',
        serial: 'SER-OFF',
      },
    });
    ctx.deviceId = leitor.id;

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        membershipNumber: `OFF-${sufixo}`,
        fullName: 'Aluno Offline',
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });
    ctx.studentId = aluno.id;

    const documento = await db.consentDocument.create({
      data: {
        tenantId: tenant.id,
        type: 'BIOMETRIC',
        version: 1,
        purpose: 'Identificacao facial para controle de acesso',
        content: 'Termo biometrico. '.repeat(5),
        contentSha256: 'd'.repeat(64),
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const consentimento = await db.consentRecord.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        documentId: documento.id,
        subjectKind: 'STUDENT',
        decision: 'ACCEPTED',
        subjectAgeYears: 36,
        occurredAt: new Date(),
      },
    });

    const identidade = await db.biometricIdentity.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        consentRecordId: consentimento.id,
        state: 'ACTIVE',
      },
    });

    await db.deviceUser.create({
      data: {
        tenantId: tenant.id,
        deviceId: leitor.id,
        studentId: aluno.id,
        identityId: identidade.id,
        externalUserId: ctx.externalUserId,
        state: 'SYNCED',
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registra ALLOW / OFFLINE_DEVICE_DECISION, com o horario do EQUIPAMENTO', async () => {
    const resposta = await registrar();

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ outcome: 'ALLOW', reason: 'OFFLINE_DEVICE_DECISION' });

    const evento = await db.accessEvent.findUniqueOrThrow({
      where: { id: (resposta.body as { accessEventId: string }).accessEventId },
    });

    expect(evento.mode).toBe('OFFLINE');
    expect(evento.studentId).toBe(ctx.studentId);
    expect(evento.deviceId).toBe(ctx.deviceId);
    expect(evento.occurredAt.toISOString()).toBe('2026-09-30T10:00:00.000Z');
    expect(evento.policyVersion).toBe(POLICY_VERSION);
    // Nunca passa pelo motor: nao ha entitlement nem validUntil calculado.
    expect(evento.entitlementId).toBeNull();
  });

  it('NAO cria passagem fisica -- a catraca ja girou, o Edge nao vai comandar de novo', async () => {
    const resposta = await registrar({ idempotencyKey: `idem-off-passagem-${randomUUID()}` });

    const passagem = await db.accessPassage.findUnique({
      where: { accessEventId: (resposta.body as { accessEventId: string }).accessEventId },
    });
    expect(passagem).toBeNull();
  });

  it('idempotente: retry com a MESMA chave devolve o MESMO evento, sem duplicar', async () => {
    const chave = `idem-off-retry-${randomUUID()}`;
    // Retry de verdade repete o corpo INTEIRO, recognitionId incluso -- e o
    // hash de divergencia (ADR-006) compara o corpo, nao so a chave.
    const recognitionId = `rec-off-retry-${randomUUID()}`;
    const antes = await db.accessEvent.count({ where: { tenantId: ctx.tenantId } });

    const r1 = await registrar({ idempotencyKey: chave, recognitionId });
    const r2 = await registrar({ idempotencyKey: chave, recognitionId });

    expect(r2.body).toMatchObject({ accessEventId: (r1.body as { accessEventId: string }).accessEventId });
    expect(await db.accessEvent.count({ where: { tenantId: ctx.tenantId } })).toBe(antes + 1);
  });

  it('registra evento sem aluno resolvido, com o motivo da recusa (nunca some em silencio)', async () => {
    const resposta = await registrar({ externalUserId: '9999-sem-aluno' });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ outcome: 'ALLOW', reason: 'OFFLINE_DEVICE_DECISION' });

    const evento = await db.accessEvent.findUniqueOrThrow({
      where: { id: (resposta.body as { accessEventId: string }).accessEventId },
    });
    expect(evento.studentId).toBeNull();
  });

  it('nao acha leitor de outro tenant pelo serial -- 404, nada gravado', async () => {
    const antes = await db.accessEvent.count({ where: { tenantId: ctx.tenantId } });

    const resposta = await registrar({ deviceSerial: 'SER-INEXISTENTE' });

    expect(resposta.status).toBe(404);
    expect(await db.accessEvent.count({ where: { tenantId: ctx.tenantId } })).toBe(antes);
  });

  it('recusa tenantId no corpo -- identidade vem da assinatura', async () => {
    const resposta = await registrar({ tenantId: ctx.tenantId });

    expect(resposta.status).toBe(400);
  });

  it('recusa outcome ou reason no corpo -- o Edge nao decide, so relata o fato', async () => {
    const resposta = await registrar({ outcome: 'DENY' });

    expect(resposta.status).toBe(400);
  });
});
