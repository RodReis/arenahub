import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CABECALHOS, assinar } from '@arenahub/api-contracts';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { EdgeAuthService } from '../../src/modules/edge-auth/edge-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Numero da catraca -> decisao de acesso, ponta a ponta (spec 2026-10-03,
 * item 3 da API). O incidente #491 foi "vinculado, e ainda DENY": afirmar
 * `linkedReaders: 1` nao basta, a catraca tem de LIBERAR pelo numero.
 *
 * Suite propria: precisa do Edge assinando (decisao e `legacy-links`) e do
 * painel autenticado (rota do numero) no mesmo tenant.
 */
describe('numero da catraca libera na decisao de acesso', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';
  const email = `tna-${sufixo}@exemplo.test`;
  const serial = `TNA-${sufixo}`;
  const ctx = { tenantId: '', gymUnitId: '', deviceId: '', keyId: '', segredo: '', cookie: '' };
  // Numeros deste run: o sufixo evita colisao entre execucoes.
  const numero = (n: number): string => `${parseInt(sufixo, 16) % 1_000_000}${String(n).padStart(6, '0')}`;

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

  const decidir = (externalUserId: string): Promise<request.Response> =>
    comoEdge('/api/v1/edge/access-decisions', {
      deviceSerial: serial,
      externalUserId,
      recognitionId: `rec-${randomUUID()}`,
      recognizedAt: new Date().toISOString(),
      idempotencyKey: `idem-${randomUUID()}`,
    });

  /** Direito valido nesta unidade, dia inteiro, todos os dias. */
  const darDireitoVigente = async (studentId: string): Promise<void> => {
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
    await db.entitlementUnitWindow.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({
        tenantId: ctx.tenantId,
        entitlementId: entitlement.id,
        gymUnitId: ctx.gymUnitId,
        dayOfWeek: dia,
        startMinute: 0,
        endMinute: 1439,
      })),
    });
  };

  const criarAluno = async (cpf: string): Promise<string> => {
    const r = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', ctx.cookie)
      .send({
        fullName: 'Aluno Da Catraca',
        birthDate: '2000-05-10',
        gymUnitId: ctx.gymUnitId,
        cpf,
        contacts: [],
      });
    expect(r.status).toBe(201);

    return (r.body as { id: string }).id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();
    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: { slug: `tna-${sufixo}`, legalName: 'TNA LTDA', displayName: 'TNA' },
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
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `EDGE-TNA-${sufixo}` },
    });
    ctx.segredo = randomBytes(32).toString('base64url');
    ctx.keyId = `key-tna-${sufixo}`;
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
        serial,
      },
    });
    ctx.deviceId = leitor.id;

    // Sem termo biometrico vigente o vinculo imediato nao nasce.
    await db.consentDocument.create({
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

    const user = await db.user.create({
      data: { email, passwordHash: await app.get(PasswordService).gerarHash(SENHA) },
    });
    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id } });
    const papel = await db.role.create({
      data: { tenantId: tenant.id, name: 'OWNER', isSystem: true },
    });
    const permissoes = await Promise.all(
      ['student.create', 'student.read', 'student.update'].map((code) =>
        db.permission.upsert({ where: { code }, create: { code }, update: {} }),
      ),
    );
    await db.rolePermission.createMany({
      data: permissoes.map((p) => ({ roleId: papel.id, permissionId: p.id })),
    });
    await db.userRole.create({ data: { tenantId: tenant.id, userId: user.id, roleId: papel.id } });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email, password: SENHA });
    const cabecalho: unknown = login.headers['set-cookie'];
    const cookies: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];
    ctx.cookie = cookies.find((c) => c.startsWith('arenahub_access=')) ?? '';
  });

  afterAll(async () => {
    // Suite que cria tenant apaga o tenant: o cascade leva o resto.
    if (ctx.tenantId) {
      await db.tenant.delete({ where: { id: ctx.tenantId } }).catch(() => undefined);
    }
    await db.user.deleteMany({ where: { email } });
    await app?.close();
  });

  it('gravar o numero que o leitor tem libera o aluno na decisao; trocar de numero move a liberacao', async () => {
    const x = numero(1);
    const y = numero(2);
    await db.deviceReaderNumber.create({
      data: { tenantId: ctx.tenantId, deviceId: ctx.deviceId, externalUserId: x, seenAt: new Date() },
    });
    const aluno = await criarAluno('52998224725');
    // Ativar o aluno e da cobranca (assinatura), nao desta suite: o cenario
    // isola o vinculo, como o `online-decision` faz.
    await db.student.update({ where: { id: aluno }, data: { status: 'ACTIVE' } });
    await darDireitoVigente(aluno);

    // 1. Vinculo imediato pela rota do numero -> ALLOW pelo numero X.
    const gravou = await request(servidor())
      .post(`/api/v1/students/${aluno}/turnstile-number`)
      .set('Cookie', ctx.cookie)
      .send({ externalId: x });
    expect(gravou.body).toEqual({ externalId: x, linkedReaders: 1 });

    const porX = await decidir(x);
    expect(porX.status).toBe(201);
    expect(porX.body).toMatchObject({ outcome: 'ALLOW', reason: 'ACTIVE_ENTITLEMENT' });
    const eventoX = await db.accessEvent.findUniqueOrThrow({
      where: { id: (porX.body as { accessEventId: string }).accessEventId },
    });
    expect(eventoX.studentId).toBe(aluno);

    // 2. Troca para Y; o leitor informa Y (face recadastrada) -> reaponta.
    const troca = await request(servidor())
      .put(`/api/v1/students/${aluno}/credentials`)
      .set('Cookie', ctx.cookie)
      .send({ kind: 'FACIAL_ENROLL_ID', externalId: y });
    expect(troca.status).toBe(200);
    const vinculo = await comoEdge('/api/v1/edge/device-users/legacy-links', {
      deviceSerial: serial,
      externalUserIds: [y],
    });
    expect(vinculo.status).toBeLessThan(300);
    expect(vinculo.body).toMatchObject({ linked: 1 });

    const porY = await decidir(y);
    expect(porY.body).toMatchObject({ outcome: 'ALLOW', reason: 'ACTIVE_ENTITLEMENT' });
    const eventoY = await db.accessEvent.findUniqueOrThrow({
      where: { id: (porY.body as { accessEventId: string }).accessEventId },
    });
    expect(eventoY.studentId).toBe(aluno);

    // O numero antigo nao abre mais para ninguem.
    const porXDepois = await decidir(x);
    expect(porXDepois.body).toMatchObject({ outcome: 'DENY' });
    const eventoXDepois = await db.accessEvent.findUniqueOrThrow({
      where: { id: (porXDepois.body as { accessEventId: string }).accessEventId },
    });
    expect(eventoXDepois.studentId).toBeNull();
    expect((eventoXDepois.detail as { identityResolution?: string }).identityResolution).toBe(
      'UNKNOWN_EXTERNAL_USER',
    );
  });
});
