import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { POLICY_VERSION } from '@arenahub/access-policy';
import { CABECALHOS, assinar } from '@arenahub/api-contracts';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { EdgeAuthService } from '../../src/modules/edge-auth/edge-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F9, Task 3 -- decisao online ponta a ponta.
 *
 * Aqui a fatia inteira encosta: HMAC autentica, identidade resolve, projecao
 * carrega, motor decide, evento e outbox gravam na mesma transacao.
 *
 * O que este arquivo defende, e que nenhum teste isolado defende:
 *
 *   - **nenhum caminho de falha vira ALLOW** (`M1-AC-006`, DoD da fatia);
 *   - negativa de DOMINIO e 200 com DENY; falha de PROTOCOLO e 4xx sem
 *     evento nenhum -- e a diferenca importa porque o Edge retenta 4xx;
 *   - o evento existe ANTES de a resposta sair (`M1` §3).
 */
describe('F9 -- decisao online de acesso', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);

  const ctx = {
    tenantId: '',
    gymUnitId: '',
    edgeNodeId: '',
    deviceId: '',
    studentId: '',
    identityId: '',
    actorId: '',
    keyId: '',
    segredo: '',
    externalUserId: '10',
  };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const comoEdge = async (
    caminho: string,
    corpo: Record<string, unknown>,
    sobrescreveSegredo?: string,
  ): Promise<request.Response> => {
    const texto = JSON.stringify(corpo);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(16).toString('base64url');

    const assinatura = assinar(
      {
        keyId: ctx.keyId,
        timestamp,
        nonce,
        method: 'POST',
        pathAndQuery: caminho,
        body: texto,
      },
      sobrescreveSegredo ?? ctx.segredo,
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

  const pedirDecisao = (
    sobrescreve: Record<string, unknown> = {},
  ): Promise<request.Response> =>
    comoEdge('/api/v1/edge/access-decisions', {
      deviceId: ctx.deviceId,
      externalUserId: ctx.externalUserId,
      recognitionId: `rec-${randomUUID()}`,
      recognizedAt: new Date().toISOString(),
      idempotencyKey: `idem-${randomUUID()}`,
      ...sobrescreve,
    });

  /** Direito valido: vale nesta unidade, sem restricao de horario. */
  const darDireitoVigente = async (studentId: string): Promise<string> => {
    const entitlement = await db.entitlement.create({
      data: {
        tenantId: ctx.tenantId,
        studentId,
        source: 'SUBSCRIPTION',
        status: 'ACTIVE',
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000 * 30),
        policySnapshot: {},
      },
    });

    // Sete dias da semana, dia inteiro: o teste isola a dimensao que quer
    // provar, e horario nao e ela.
    await db.entitlementUnitWindow.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({
        entitlementId: entitlement.id,
        gymUnitId: ctx.gymUnitId,
        dayOfWeek: dia,
        startMinute: 0,
        endMinute: 1439,
      })),
    });

    return entitlement.id;
  };

  const limparDireitos = async (studentId: string): Promise<void> => {
    await db.entitlement.deleteMany({ where: { tenantId: ctx.tenantId, studentId } });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `f9-online-${sufixo}`,
        legalName: 'Online LTDA',
        displayName: 'Online',
      },
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
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `EDGE-ON-${sufixo}` },
    });

    ctx.edgeNodeId = node.id;
    ctx.segredo = randomBytes(32).toString('base64url');
    ctx.keyId = `key-online-${sufixo}`;

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
        model: 'Inner Fit',
        serial: `SER-ON-${sufixo}`,
      },
    });

    ctx.deviceId = leitor.id;

    const operador = await db.user.create({
      data: { email: `f9-on-${sufixo}@exemplo.test`, passwordHash: await app.get(PasswordService).gerarHash('f9-online-senha-de-teste') },
    });

    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: operador.id } });

    ctx.actorId = operador.id;

    const documento = await db.consentDocument.create({
      data: {
        tenantId: tenant.id,
        type: 'BIOMETRIC',
        version: 1,
        purpose: 'Identificacao facial para controle de acesso',
        content: 'Termo biometrico. '.repeat(5),
        contentSha256: 'c'.repeat(64),
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
          gymUnitId: ctx.gymUnitId,
        membershipNumber: `MO-${sufixo}`,
        fullName: 'Aluno Online',
        birthDate: new Date('1994-02-02T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    ctx.studentId = aluno.id;

    const consentimento = await db.consentRecord.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        documentId: documento.id,
        subjectKind: 'STUDENT',
        decision: 'ACCEPTED',
        subjectAgeYears: 32,
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

    ctx.identityId = identidade.id;

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

  describe('caminho de entrada (M1-AC-005)', () => {
    it('libera aluno com direito vigente e grava evento correlacionado', async () => {
      const entitlementId = await darDireitoVigente(ctx.studentId);

      const resposta = await pedirDecisao();

      expect(resposta.status).toBe(201);

      const corpo = resposta.body as {
        accessEventId: string;
        outcome: string;
        reason: string;
        validUntil: string | null;
        policyVersion: string;
      };

      expect(corpo.outcome).toBe('ALLOW');
      expect(corpo.reason).toBe('ACTIVE_ENTITLEMENT');
      /*
        DERIVADO da fonte, nao literal: `POLICY_VERSION` sobe quando o motor
        muda de comportamento observavel (foi para 1.1.0 na F15, que
        acrescentou `PAYMENT_OVERDUE`). Fixar o numero aqui faria toda fatia
        que mexe na politica quebrar um teste que nao tem nada a ver com ela.

        O que importa e que a decisao carregue a versao VIGENTE -- e e isso
        que a comparacao afirma.
      */
      expect(corpo.policyVersion).toBe(POLICY_VERSION);
      expect(corpo.validUntil).not.toBeNull();

      // O evento ja existe quando a resposta sai -- `M1` §3.
      const evento = await db.accessEvent.findUniqueOrThrow({
        where: { id: corpo.accessEventId },
      });

      expect(evento.outcome).toBe('ALLOW');
      expect(evento.studentId).toBe(ctx.studentId);
      expect(evento.entitlementId).toBe(entitlementId);
      expect(evento.mode).toBe('ONLINE');
      expect(evento.recognizedAt).not.toBeNull();

      await limparDireitos(ctx.studentId);
    });

    it('publica AccessGranted no outbox, na mesma transacao', async () => {
      await darDireitoVigente(ctx.studentId);

      const resposta = await pedirDecisao();
      const { accessEventId } = resposta.body as { accessEventId: string };

      const evento = await db.outboxEvent.findFirstOrThrow({
        where: { aggregateId: accessEventId, aggregateType: 'AccessEvent' },
      });

      expect(evento.eventType).toBe('AccessGranted');

      const payload = evento.payload as Record<string, unknown>;

      expect(payload['outcome']).toBe('ALLOW');
      // `M1` §15: payload sem CPF, divida, foto ou template.
      expect(Object.keys(payload)).not.toContain('cpf');
      expect(Object.keys(payload)).not.toContain('cpfHash');

      await limparDireitos(ctx.studentId);
    });
  });

  describe('negativas de dominio sao 200 com DENY (M1-AC-006)', () => {
    it('nega aluno sem nenhum direito', async () => {
      await limparDireitos(ctx.studentId);

      const resposta = await pedirDecisao();

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ outcome: 'DENY', reason: 'NO_ENTITLEMENT' });
    });

    it('nega direito expirado', async () => {
      await limparDireitos(ctx.studentId);

      const entitlement = await db.entitlement.create({
        data: {
          tenantId: ctx.tenantId,
          studentId: ctx.studentId,
          source: 'SUBSCRIPTION',
          status: 'ACTIVE',
          startsAt: new Date(Date.now() - 86_400_000 * 60),
          endsAt: new Date(Date.now() - 86_400_000),
          policySnapshot: {},
        },
      });

      await db.entitlementUnitWindow.create({
        data: {
          entitlementId: entitlement.id,
          gymUnitId: ctx.gymUnitId,
          dayOfWeek: new Date().getDay(),
          startMinute: 0,
          endMinute: 1439,
        },
      });

      const resposta = await pedirDecisao();

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ outcome: 'DENY', reason: 'NO_ENTITLEMENT' });

      await limparDireitos(ctx.studentId);
    });

    it('nega com WRONG_UNIT quando o direito vale so em outra unidade', async () => {
      await limparDireitos(ctx.studentId);

      const outraUnidade = await db.gymUnit.create({
        data: {
          tenantId: ctx.tenantId,
          code: `OUTRA-${randomUUID().slice(0, 4)}`,
          name: 'Outra',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        },
      });

      const entitlement = await db.entitlement.create({
        data: {
          tenantId: ctx.tenantId,
          studentId: ctx.studentId,
          source: 'SUBSCRIPTION',
          status: 'ACTIVE',
          startsAt: new Date(Date.now() - 86_400_000),
          endsAt: new Date(Date.now() + 86_400_000 * 30),
          policySnapshot: {},
        },
      });

      await db.entitlementUnitWindow.create({
        data: {
          entitlementId: entitlement.id,
          gymUnitId: outraUnidade.id,
          dayOfWeek: new Date().getDay(),
          startMinute: 0,
          endMinute: 1439,
        },
      });

      const resposta = await pedirDecisao();

      expect(resposta.body).toMatchObject({ outcome: 'DENY', reason: 'WRONG_UNIT' });

      await limparDireitos(ctx.studentId);
    });

    it('nega aluno bloqueado com rotulo proprio', async () => {
      await darDireitoVigente(ctx.studentId);
      await db.student.update({
        where: { id: ctx.studentId },
        data: { status: 'BLOCKED' },
      });

      const resposta = await pedirDecisao();

      expect(resposta.body).toMatchObject({ outcome: 'DENY', reason: 'STUDENT_BLOCKED' });

      await db.student.update({
        where: { id: ctx.studentId },
        data: { status: 'ACTIVE' },
      });
      await limparDireitos(ctx.studentId);
    });

    it('nega sob bloqueio administrativo, mesmo com direito perfeito', async () => {
      await darDireitoVigente(ctx.studentId);

      const bloqueio = await db.administrativeBlock.create({
        data: {
          tenantId: ctx.tenantId,
          studentId: ctx.studentId,
          reason: 'pendencia operacional',
          actorId: ctx.actorId,
          startsAt: new Date(Date.now() - 3_600_000),
        },
      });

      const resposta = await pedirDecisao();

      expect(resposta.body).toMatchObject({ outcome: 'DENY', reason: 'ADMIN_BLOCK' });

      await db.administrativeBlock.delete({ where: { id: bloqueio.id } });
      await limparDireitos(ctx.studentId);
    });

    it('nega identidade desconhecida no leitor, e registra o evento assim mesmo', async () => {
      const resposta = await pedirDecisao({ externalUserId: '65535' });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ outcome: 'DENY', reason: 'NO_ENTITLEMENT' });

      const { accessEventId } = resposta.body as { accessEventId: string };

      const evento = await db.accessEvent.findUniqueOrThrow({ where: { id: accessEventId } });

      // Sem aluno, mas COM o que o leitor viu -- e a unica pista de quem foi.
      expect(evento.studentId).toBeNull();
      expect(evento.externalUserId).toBe('65535');

      const detalhe = evento.detail as { identityResolution?: string };

      expect(detalhe.identityResolution).toBe('UNKNOWN_EXTERNAL_USER');
    });

    it('nega biometria revogada com exclusao fisica ainda pendente (M1-BR-005)', async () => {
      await darDireitoVigente(ctx.studentId);

      await db.biometricIdentity.update({
        where: { id: ctx.identityId },
        data: { state: 'DELETION_PENDING' },
      });

      const resposta = await pedirDecisao();

      expect(resposta.body).toMatchObject({ outcome: 'DENY' });

      const { accessEventId } = resposta.body as { accessEventId: string };
      const evento = await db.accessEvent.findUniqueOrThrow({ where: { id: accessEventId } });
      const detalhe = evento.detail as { identityResolution?: string };

      expect(detalhe.identityResolution).toBe('IDENTITY_NOT_ACTIVE');

      await db.biometricIdentity.update({
        where: { id: ctx.identityId },
        data: { state: 'ACTIVE' },
      });
      await limparDireitos(ctx.studentId);
    });
  });

  describe('falha de protocolo e 4xx sem gravar evento', () => {
    const contarEventos = () =>
      db.accessEvent.count({ where: { tenantId: ctx.tenantId } });

    it('recusa assinatura invalida e nao registra nada', async () => {
      const antes = await contarEventos();

      const resposta = await comoEdge(
        '/api/v1/edge/access-decisions',
        {
          deviceId: ctx.deviceId,
          externalUserId: ctx.externalUserId,
          recognitionId: `rec-${randomUUID()}`,
          recognizedAt: new Date().toISOString(),
          idempotencyKey: `idem-${randomUUID()}`,
        },
        'segredo-errado-mas-do-tamanho-certo-aqui',
      );

      expect(resposta.status).toBe(401);
      expect(await contarEventos()).toBe(antes);
    });

    it('recusa tenantId no corpo -- identidade vem da assinatura', async () => {
      const antes = await contarEventos();

      const resposta = await pedirDecisao({ tenantId: randomUUID() });

      expect(resposta.status).toBe(400);
      expect(await contarEventos()).toBe(antes);
    });

    it('recusa corpo malformado', async () => {
      const antes = await contarEventos();

      const resposta = await pedirDecisao({ recognizedAt: 'ontem' });

      expect(resposta.status).toBe(400);
      expect(await contarEventos()).toBe(antes);
    });

    it('recusa dispositivo de outra unidade sem virar ALLOW', async () => {
      await darDireitoVigente(ctx.studentId);

      const outraUnidade = await db.gymUnit.create({
        data: {
          tenantId: ctx.tenantId,
          code: `ALHEIA-${randomUUID().slice(0, 4)}`,
          name: 'Alheia',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        },
      });

      const alheio = await db.device.create({
        data: {
          tenantId: ctx.tenantId,
          gymUnitId: outraUnidade.id,
          kind: 'FACIAL_READER',
          model: 'Inner Fit',
          serial: `SER-ALHEIO-${sufixo}`,
        },
      });

      const resposta = await pedirDecisao({ deviceId: alheio.id });

      expect(resposta.body).toMatchObject({ outcome: 'DENY' });

      const { accessEventId } = resposta.body as { accessEventId: string };
      const evento = await db.accessEvent.findUniqueOrThrow({ where: { id: accessEventId } });
      const detalhe = evento.detail as { identityResolution?: string };

      expect(detalhe.identityResolution).toBe('DEVICE_NOT_IN_SCOPE');

      await limparDireitos(ctx.studentId);
    });
  });

  describe('idempotencia (ADR-006)', () => {
    it('retry com a mesma chave devolve a MESMA decisao, sem novo evento', async () => {
      await darDireitoVigente(ctx.studentId);

      const chave = `idem-fixa-${randomUUID()}`;
      const reconhecimento = `rec-fixo-${randomUUID()}`;

      const primeira = await pedirDecisao({
        idempotencyKey: chave,
        recognitionId: reconhecimento,
      });

      const segunda = await pedirDecisao({
        idempotencyKey: chave,
        recognitionId: reconhecimento,
      });

      const a = primeira.body as { accessEventId: string; replayed: boolean };
      const b = segunda.body as { accessEventId: string; replayed: boolean };

      expect(a.replayed).toBe(false);
      expect(b.replayed).toBe(true);
      expect(b.accessEventId).toBe(a.accessEventId);

      const total = await db.accessEvent.count({
        where: { tenantId: ctx.tenantId, idempotencyKey: chave },
      });

      expect(total).toBe(1);

      await limparDireitos(ctx.studentId);
    });

    it('retry NAO republica no outbox', async () => {
      await darDireitoVigente(ctx.studentId);

      const chave = `idem-outbox-${randomUUID()}`;
      const reconhecimento = `rec-outbox-${randomUUID()}`;

      const primeira = await pedirDecisao({
        idempotencyKey: chave,
        recognitionId: reconhecimento,
      });
      await pedirDecisao({ idempotencyKey: chave, recognitionId: reconhecimento });

      const { accessEventId } = primeira.body as { accessEventId: string };

      const publicados = await db.outboxEvent.count({
        where: { aggregateId: accessEventId },
      });

      expect(publicados).toBe(1);

      await limparDireitos(ctx.studentId);
    });

    it('mesma chave com corpo diferente e conflito', async () => {
      await darDireitoVigente(ctx.studentId);

      const chave = `idem-conflito-${randomUUID()}`;

      await pedirDecisao({ idempotencyKey: chave, recognitionId: 'rec-a' });

      const divergente = await pedirDecisao({
        idempotencyKey: chave,
        recognitionId: 'rec-b',
      });

      expect(divergente.status).toBe(409);

      await limparDireitos(ctx.studentId);
    });
  });

  describe('desfecho da passagem (M1-FR-022)', () => {
    const decidirEObter = async (): Promise<string> => {
      await darDireitoVigente(ctx.studentId);

      const resposta = await pedirDecisao();
      const { accessEventId } = resposta.body as { accessEventId: string };

      await limparDireitos(ctx.studentId);

      return accessEventId;
    };

    it('registra CONFIRMED sem tocar no evento imutavel', async () => {
      const accessEventId = await decidirEObter();

      const antes = await db.accessEvent.findUniqueOrThrow({ where: { id: accessEventId } });

      const resposta = await comoEdge(
        `/api/v1/edge/access-events/${accessEventId}/passage`,
        {
          state: 'CONFIRMED',
          commandId: accessEventId,
          reportedAt: new Date().toISOString(),
        },
      );

      expect(resposta.status).toBe(201);

      const passagem = await db.accessPassage.findUniqueOrThrow({
        where: { accessEventId },
      });

      expect(passagem.state).toBe('CONFIRMED');

      // O evento nao mudou -- `M1-BR-009`.
      const depois = await db.accessEvent.findUniqueOrThrow({ where: { id: accessEventId } });

      expect(depois.outcome).toBe(antes.outcome);
      expect(depois.occurredAt.toISOString()).toBe(antes.occurredAt.toISOString());
    });

    it('repetir o mesmo desfecho e inofensivo', async () => {
      const accessEventId = await decidirEObter();

      const corpo = {
        state: 'CONFIRMED' as const,
        commandId: accessEventId,
        reportedAt: new Date().toISOString(),
      };

      await comoEdge(`/api/v1/edge/access-events/${accessEventId}/passage`, corpo);
      const segunda = await comoEdge(
        `/api/v1/edge/access-events/${accessEventId}/passage`,
        corpo,
      );

      expect(segunda.status).toBe(201);
    });

    it('desfecho DIFERENTE do ja registrado e conflito', async () => {
      const accessEventId = await decidirEObter();

      await comoEdge(`/api/v1/edge/access-events/${accessEventId}/passage`, {
        state: 'CONFIRMED',
        commandId: accessEventId,
        reportedAt: new Date().toISOString(),
      });

      const divergente = await comoEdge(
        `/api/v1/edge/access-events/${accessEventId}/passage`,
        {
          state: 'TIMED_OUT',
          commandId: accessEventId,
          reportedAt: new Date().toISOString(),
        },
      );

      expect(divergente.status).toBe(409);
    });

    it('nao fecha passagem de evento de outro tenant', async () => {
      const outroTenant = await db.tenant.create({
        data: {
          slug: `f9-vizinho-${sufixo}`,
          legalName: 'Vizinho LTDA',
          displayName: 'Vizinho',
        },
      });

      const outraUnidade = await db.gymUnit.create({
        data: {
          tenantId: outroTenant.id,
          code: 'UNICA',
          name: 'Unica',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        },
      });

      const alheio = await db.accessEvent.create({
        data: {
          tenantId: outroTenant.id,
          gymUnitId: outraUnidade.id,
          outcome: 'ALLOW',
          reason: 'ACTIVE_ENTITLEMENT',
          policyVersion: '1.0.0',
          mode: 'ONLINE',
          method: 'FACIAL',
          occurredAt: new Date(),
          correlationId: randomUUID(),
          idempotencyKey: `alheio-${randomUUID()}`,
          detail: {},
        },
      });

      const resposta = await comoEdge(
        `/api/v1/edge/access-events/${alheio.id}/passage`,
        {
          state: 'CONFIRMED',
          commandId: alheio.id,
          reportedAt: new Date().toISOString(),
        },
      );

      expect(resposta.status).toBe(404);

      const passagem = await db.accessPassage.findUnique({
        where: { accessEventId: alheio.id },
      });

      expect(passagem).toBeNull();
    });

    it('recusa estado que o Edge nao observa', async () => {
      const accessEventId = await decidirEObter();

      const resposta = await comoEdge(
        `/api/v1/edge/access-events/${accessEventId}/passage`,
        {
          state: 'PENDING',
          commandId: accessEventId,
          reportedAt: new Date().toISOString(),
        },
      );

      expect(resposta.status).toBe(400);
    });
  });

  describe('deriva de relogio', () => {
    it('registra a deriva mas decide pelo relogio do servidor', async () => {
      await darDireitoVigente(ctx.studentId);

      // Catraca uma hora adiantada. Se o relogio dela decidisse, um direito
      // que expira em 30 min ainda pareceria valido.
      const adiantado = new Date(Date.now() + 3_600_000).toISOString();

      const resposta = await pedirDecisao({ recognizedAt: adiantado });

      expect(resposta.body).toMatchObject({ outcome: 'ALLOW' });

      const { accessEventId } = resposta.body as { accessEventId: string };
      const evento = await db.accessEvent.findUniqueOrThrow({ where: { id: accessEventId } });
      const detalhe = evento.detail as { clockDriftMs?: number; clockDriftExceeded?: boolean };

      expect(detalhe.clockDriftMs).toBeGreaterThan(3_000_000);
      expect(detalhe.clockDriftExceeded).toBe(true);

      // Os DOIS relogios ficam guardados: sem isso, a evidencia da deriva
      // some justamente quando ela importa.
      expect(evento.recognizedAt?.toISOString()).toBe(adiantado);
      expect(evento.occurredAt.getTime()).toBeLessThan(new Date(adiantado).getTime());

      await limparDireitos(ctx.studentId);
    });
  });
});
