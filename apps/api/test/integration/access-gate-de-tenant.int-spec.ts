import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { AccessProjectionRepository } from '../../src/modules/access/access-projection.repository.js';
import {
  DecideOnlineAccessUseCase,
  type ReconhecimentoRecebido,
} from '../../src/modules/access/decide-online-access.use-case.js';
import type { ContextoDoEdge } from '../../src/modules/edge-auth/edge-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F65 -- a projecao deriva o gate do status do tenant (ADR-053).
 *
 * O que este arquivo prova: `montarEntrada` le o status REAL do tenant no
 * banco e traduz para `tenant.gateActive`, sem depender de coluna propria.
 * Ampliado na Task 4 com o efeito de ponta a ponta na decisao de acesso.
 */
describe('F65 -- a projecao deriva o gate do status do tenant', () => {
  let app: INestApplication;
  let db: PrismaService;
  let projecao: AccessProjectionRepository;
  let decideOnlineAccess: DecideOnlineAccessUseCase;

  const sufixo = randomUUID().slice(0, 8);
  const agora = new Date('2026-09-09T12:00:00.000Z');

  let tenantId: string;
  let unidadeId: string;
  let alunoId: string;
  let edgeNodeId: string;
  let deviceId: string;

  /** externalUserId do leitor para o aluno de teste (Task 4). */
  const externalUserId = 'gate-tenant-1';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    projecao = app.get(AccessProjectionRepository);
    decideOnlineAccess = app.get(DecideOnlineAccessUseCase);

    const tenant = await db.tenant.create({
      data: {
        slug: `f65-gate-${sufixo}`,
        legalName: 'Gate de Tenant LTDA',
        displayName: 'Gate de Tenant',
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

    unidadeId = unidade.id;

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidadeId,
        membershipNumber: `GATE-${sufixo}`,
        fullName: 'Aluno Gate de Tenant',
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    alunoId = aluno.id;

    const entitlement = await db.entitlement.create({
      data: {
        tenantId: tenant.id,
        studentId: alunoId,
        source: 'SUBSCRIPTION',
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: new Date('2026-12-31T23:59:59.000Z'),
        policySnapshot: {},
      },
    });

    // Sete dias da semana, dia inteiro: o teste isola o gate do tenant, e
    // horario nao e a dimensao que ele quer provar.
    await db.entitlementUnitWindow.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({
        entitlementId: entitlement.id,
        gymUnitId: unidadeId,
        dayOfWeek: dia,
        startMinute: 0,
        endMinute: 1439,
      })),
    });

    // Cadeia de identidade (Task 4): Device -> ConsentRecord ->
    // BiometricIdentity -> DeviceUser. So existe para permitir chamar
    // `DecideOnlineAccessUseCase.executar` de ponta a ponta -- o gate em si
    // nao depende de biometria, mas a decisao completa precisa resolver a
    // identidade antes de chegar no motor.
    const edgeNode = await db.edgeNode.create({
      data: { tenantId: tenant.id, gymUnitId: unidadeId, code: `EDGE-GATE-${sufixo}` },
    });

    edgeNodeId = edgeNode.id;

    const device = await db.device.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidadeId,
        edgeNodeId: edgeNode.id,
        kind: 'FACIAL_READER',
        model: 'Inner Fit',
        serial: `SER-GATE-${sufixo}`,
      },
    });

    deviceId = device.id;

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

    const consentimento = await db.consentRecord.create({
      data: {
        tenantId: tenant.id,
        studentId: alunoId,
        documentId: documento.id,
        subjectKind: 'STUDENT',
        decision: 'ACCEPTED',
        subjectAgeYears: 36,
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const identidade = await db.biometricIdentity.create({
      data: {
        tenantId: tenant.id,
        studentId: alunoId,
        consentRecordId: consentimento.id,
        state: 'ACTIVE',
      },
    });

    await db.deviceUser.create({
      data: {
        tenantId: tenant.id,
        deviceId: device.id,
        studentId: alunoId,
        identityId: identidade.id,
        externalUserId,
        state: 'SYNCED',
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  /**
   * Monta o contexto do Edge ja autenticado (o gate nao testa HMAC) e chama
   * a decisao online completa, como `access-event.int-spec.ts` faz. Resolve
   * sempre o mesmo aluno, pelo `externalUserId` do leitor cadastrado no
   * setup -- unico aluno desta suite.
   */
  const decidir = async () => {
    const edge: ContextoDoEdge = {
      tenantId,
      gymUnitId: unidadeId,
      edgeNodeId,
      keyId: 'irrelevante-para-o-gate',
    };

    const entrada: ReconhecimentoRecebido = {
      deviceId,
      externalUserId,
      recognitionId: `rec-${randomUUID()}`,
      recognizedAt: new Date(),
      idempotencyKey: `idem-${randomUUID()}`,
      correlationId: randomUUID(),
    };

    return decideOnlineAccess.executar(edge, entrada);
  };

  it('tenant ACTIVE produz gateActive false', async () => {
    const entrada = await projecao.montarEntrada(tenantId, unidadeId, alunoId, 'ACTIVE', agora);

    expect(entrada.tenant.gateActive).toBe(false);
  });

  it('tenant SUSPENDED produz gateActive true', async () => {
    await db.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });

    const entrada = await projecao.montarEntrada(tenantId, unidadeId, alunoId, 'ACTIVE', agora);

    expect(entrada.tenant.gateActive).toBe(true);
  });

  it('tenant INACTIVE NAO fecha a catraca', async () => {
    /*
     * ADR-052 SS4: INACTIVE e o dono do SaaS desligando o cliente; o
     * ADR-053 fala so de inadimplencia. Colapsar os dois faria um
     * desligamento administrativo negar dizendo "suspensa por divida" --
     * mentira gravada num fato imutavel.
     */
    await db.tenant.update({ where: { id: tenantId }, data: { status: 'INACTIVE' } });

    const entrada = await projecao.montarEntrada(tenantId, unidadeId, alunoId, 'ACTIVE', agora);

    expect(entrada.tenant.gateActive).toBe(false);
  });

  describe('F65 -- o gate NAO revoga nada (ADR-053 SS2)', () => {
    it('Entitlements ficam identicos antes, durante e depois da suspensao', async () => {
      /*
       * O criterio de aceite da #288. Revogar em massa seria destrutivo e
       * irreversivel na pratica; o gate existe justamente para nao fazer
       * isso.
       *
       * Compara a LINHA INTEIRA, campo a campo, e nao so o status: uma
       * implementacao que "so" mexesse em `endsAt` passaria por uma
       * comparacao de status e teria estragado o direito do aluno.
       *
       * Nao confia na ordem dos `it` anteriores (ledger da Task 2): seta
       * ACTIVE explicitamente antes de comecar.
       */
      await db.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });

      const antes = await db.entitlement.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      });

      await db.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });

      const decisaoComGate = await decidir();

      const durante = await db.entitlement.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      });

      await db.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });

      const decisaoSemGate = await decidir();

      const depois = await db.entitlement.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      });

      expect(decisaoComGate.outcome).toBe('DENY');
      expect(decisaoComGate.reason).toBe('TENANT_SUSPENDED');
      expect(decisaoSemGate.outcome).toBe('ALLOW');

      expect(durante).toEqual(antes);
      expect(depois).toEqual(antes);
    });

    it('o AccessEvent negado registra a razao do gate', async () => {
      // Sem isso, "por que a academia inteira nao passou naquele dia?" so se
      // responde reconstruindo o estado do tenant, que ja mudou. Nao confia
      // na ordem dos `it` anteriores: seta ACTIVE antes de suspender.
      await db.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
      await db.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });

      await decidir();

      const evento = await db.accessEvent.findFirst({
        where: { tenantId },
        orderBy: { occurredAt: 'desc' },
      });

      expect(evento?.outcome).toBe('DENY');
      expect(evento?.reason).toBe('TENANT_SUSPENDED');
      expect(evento?.policyVersion).toBe('2.0.0');

      // Deixa o tenant ACTIVE para nao vazar estado para describes futuros.
      await db.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
    });
  });
});
