import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { AccessEventRepository } from '../../src/modules/access/access-event.repository.js';
import { AccessProjectionRepository } from '../../src/modules/access/access-projection.repository.js';
import { IdentityResolver } from '../../src/modules/access/identity-resolver.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { EdgeAuthService } from '../../src/modules/edge-auth/edge-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F9, Task 2 -- persistencia imutavel e resolucao de identidade por escopo.
 *
 * O que so integracao prova:
 *
 *   - a constraint de idempotencia existe DE FATO no banco, inclusive o
 *     indice parcial do evento nascido na nuvem (`edge_node_id` NULO);
 *   - identidade resolve pelo escopo certo e NAO resolve pelo errado;
 *   - tenant A nao le evento de tenant B (`M1-NFR-007`);
 *   - correcao acrescenta linha e deixa o original intacto (`M1-BR-009`).
 */
describe('F9 -- evento de acesso e resolucao de identidade', () => {
  let app: INestApplication;
  let db: PrismaService;
  let eventos: AccessEventRepository;
  let projecao: AccessProjectionRepository;
  let resolver: IdentityResolver;

  const sufixo = randomUUID().slice(0, 8);

  /** Tenant principal. */
  const a = {
    tenantId: '',
    gymUnitId: '',
    outraUnidadeId: '',
    edgeNodeId: '',
    deviceId: '',
    studentId: '',
    identityId: '',
    externalUserId: '1',
    /** Usuario real: `audit_logs.actor_id` tem FK para `users`. */
    actorId: '',
  };

  /** Tenant vizinho -- existe so para provar que nao se enxergam. */
  const b = { tenantId: '', gymUnitId: '', edgeNodeId: '', deviceId: '' };

  const contextoEdgeA = () => ({
    tenantId: a.tenantId,
    gymUnitId: a.gymUnitId,
    edgeNodeId: a.edgeNodeId,
    keyId: 'irrelevante',
  });

  const eventoBase = (sobrescreve: Record<string, unknown> = {}) => ({
    tenantId: a.tenantId,
    gymUnitId: a.gymUnitId,
    edgeNodeId: a.edgeNodeId,
    deviceId: a.deviceId,
    studentId: a.studentId,
    identityId: a.identityId,
    externalUserId: a.externalUserId,
    recognitionId: `rec-${randomUUID()}`,
    outcome: 'ALLOW' as const,
    reason: 'ACTIVE_ENTITLEMENT' as const,
    entitlementId: null,
    validUntil: null,
    policyVersion: '1.0.0',
    mode: 'ONLINE' as const,
    method: 'FACIAL' as const,
    recognizedAt: new Date(),
    occurredAt: new Date(),
    correlationId: randomUUID(),
    idempotencyKey: `idem-${randomUUID()}`,
    detail: {},
    ...sobrescreve,
  });

  const criarTenant = async (
    rotulo: string,
  ): Promise<{ tenantId: string; gymUnitId: string; edgeNodeId: string; deviceId: string }> => {
    const tenant = await db.tenant.create({
      data: {
        slug: `f9-${rotulo}-${sufixo}`,
        legalName: `F9 ${rotulo} LTDA`,
        displayName: `F9 ${rotulo}`,
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
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `EDGE-${rotulo}-${sufixo}` },
    });

    const segredo = randomBytes(32).toString('base64url');

    await db.edgeCredential.create({
      data: {
        tenantId: tenant.id,
        edgeNodeId: node.id,
        keyId: `key-f9-${rotulo}-${sufixo}`,
        encryptedSecret: app.get(EdgeAuthService).cifrarSegredo(segredo),
        activeFrom: new Date(Date.now() - 60_000),
      },
    });

    const dispositivo = await db.device.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        edgeNodeId: node.id,
        kind: 'FACIAL_READER',
        model: 'Inner Fit',
        serial: `SER-F9-${rotulo}-${sufixo}`,
      },
    });

    return {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      edgeNodeId: node.id,
      deviceId: dispositivo.id,
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);
    eventos = app.get(AccessEventRepository);
    projecao = app.get(AccessProjectionRepository);
    resolver = app.get(IdentityResolver);

    const tenantA = await criarTenant('a');
    const tenantB = await criarTenant('b');

    Object.assign(a, tenantA);
    Object.assign(b, tenantB);

    const segundaUnidade = await db.gymUnit.create({
      data: {
        tenantId: a.tenantId,
        code: 'BAIRRO',
        name: 'Bairro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    a.outraUnidadeId = segundaUnidade.id;

    const documento = await db.consentDocument.create({
      data: {
        tenantId: a.tenantId,
        type: 'BIOMETRIC',
        version: 1,
        purpose: 'Identificacao facial para controle de acesso',
        content: 'Termo biometrico. '.repeat(5),
        contentSha256: 'b'.repeat(64),
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const aluno = await db.student.create({
      data: {
        tenantId: a.tenantId,
        membershipNumber: `M-${sufixo}`,
        fullName: 'Aluna Acesso',
        birthDate: new Date('1996-05-10T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    a.studentId = aluno.id;

    const operador = await db.user.create({
      data: { email: `f9-op-${sufixo}@exemplo.test`, passwordHash: await app.get(PasswordService).gerarHash('f9-acesso-senha-de-teste') },
    });

    await db.tenantMembership.create({
      data: { tenantId: a.tenantId, userId: operador.id },
    });

    a.actorId = operador.id;

    const consentimento = await db.consentRecord.create({
      data: {
        tenantId: a.tenantId,
        studentId: aluno.id,
        documentId: documento.id,
        subjectKind: 'STUDENT',
        decision: 'ACCEPTED',
        subjectAgeYears: 30,
        occurredAt: new Date(),
      },
    });

    const identidade = await db.biometricIdentity.create({
      data: {
        tenantId: a.tenantId,
        studentId: aluno.id,
        consentRecordId: consentimento.id,
        state: 'ACTIVE',
      },
    });

    a.identityId = identidade.id;

    await db.deviceUser.create({
      data: {
        tenantId: a.tenantId,
        deviceId: a.deviceId,
        studentId: aluno.id,
        identityId: identidade.id,
        externalUserId: a.externalUserId,
        state: 'SYNCED',
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('resolucao de identidade (M1-FR-019)', () => {
    it('resolve o aluno pelo escopo correto de tenant, unidade e Edge', async () => {
      const resultado = await resolver.resolver(contextoEdgeA(), a.deviceId, a.externalUserId);

      expect(resultado).toMatchObject({
        resolvida: true,
        studentId: a.studentId,
        identityId: a.identityId,
        studentStatus: 'ACTIVE',
      });
    });

    it('NAO resolve dispositivo de outro tenant, mesmo com o UUID correto', async () => {
      const resultado = await resolver.resolver(contextoEdgeA(), b.deviceId, a.externalUserId);

      expect(resultado).toMatchObject({ resolvida: false, motivo: 'DEVICE_NOT_IN_SCOPE' });
    });

    it('NAO resolve quando o Edge assinante nao e o dono do dispositivo', async () => {
      const resultado = await resolver.resolver(
        { ...contextoEdgeA(), edgeNodeId: b.edgeNodeId },
        a.deviceId,
        a.externalUserId,
      );

      expect(resultado).toMatchObject({ resolvida: false, motivo: 'DEVICE_NOT_IN_SCOPE' });
    });

    it('devolve DENY para externalUserId desconhecido, sem excecao', async () => {
      const resultado = await resolver.resolver(contextoEdgeA(), a.deviceId, '99999');

      expect(resultado).toMatchObject({ resolvida: false, motivo: 'UNKNOWN_EXTERNAL_USER' });
    });

    it('bloqueia identidade revogada na hora, mesmo com exclusao fisica pendente (M1-BR-005)', async () => {
      const outroAluno = await db.student.create({
        data: {
          tenantId: a.tenantId,
          membershipNumber: `M-REV-${sufixo}`,
          fullName: 'Aluno Revogado',
          birthDate: new Date('1990-01-01T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      });

      const documento = await db.consentDocument.findFirstOrThrow({
        where: { tenantId: a.tenantId },
      });

      const consentimento = await db.consentRecord.create({
        data: {
          tenantId: a.tenantId,
          studentId: outroAluno.id,
          documentId: documento.id,
          subjectKind: 'STUDENT',
          decision: 'ACCEPTED',
          subjectAgeYears: 30,
          occurredAt: new Date(),
        },
      });

      const identidade = await db.biometricIdentity.create({
        data: {
          tenantId: a.tenantId,
          studentId: outroAluno.id,
          consentRecordId: consentimento.id,
          // Revogada, mas o `DeviceUser` continua SYNCED: e exatamente a
          // janela entre a revogacao logica e a exclusao fisica.
          state: 'DELETION_PENDING',
        },
      });

      await db.deviceUser.create({
        data: {
          tenantId: a.tenantId,
          deviceId: a.deviceId,
          studentId: outroAluno.id,
          identityId: identidade.id,
          externalUserId: '777',
          state: 'SYNCED',
        },
      });

      const resultado = await resolver.resolver(contextoEdgeA(), a.deviceId, '777');

      expect(resultado).toMatchObject({ resolvida: false, motivo: 'IDENTITY_NOT_ACTIVE' });
    });
  });

  describe('append idempotente (ADR-006)', () => {
    it('grava a decisao e devolve o evento', async () => {
      const { evento, jaExistia } = await eventos.append(eventoBase());

      expect(jaExistia).toBe(false);
      expect(evento.outcome).toBe('ALLOW');
      expect(evento.reason).toBe('ACTIVE_ENTITLEMENT');
    });

    it('retry com o MESMO corpo devolve o MESMO evento, sem duplicar', async () => {
      const dados = eventoBase();

      const primeiro = await eventos.append(dados);
      const segundo = await eventos.append({ ...dados, correlationId: randomUUID() });

      expect(segundo.jaExistia).toBe(true);
      expect(segundo.evento.id).toBe(primeiro.evento.id);

      const total = await db.accessEvent.count({
        where: { tenantId: a.tenantId, idempotencyKey: dados.idempotencyKey },
      });

      expect(total).toBe(1);
    });

    it('mesma chave com corpo DIFERENTE e conflito, nunca sobrescrita silenciosa', async () => {
      const dados = eventoBase();

      await eventos.append(dados);

      await expect(
        eventos.append({ ...dados, outcome: 'DENY', reason: 'NO_ENTITLEMENT' }),
      ).rejects.toMatchObject({ response: { code: 'ACCESS_IDEMPOTENCY_CONFLICT' } });
    });

    it('registra DENY sem aluno resolvido -- evento sem studentId e valido', async () => {
      const { evento } = await eventos.append(
        eventoBase({
          studentId: null,
          identityId: null,
          outcome: 'DENY',
          reason: 'NO_ENTITLEMENT',
          externalUserId: '4242',
        }),
      );

      expect(evento.studentId).toBeNull();
      expect(evento.externalUserId).toBe('4242');
    });
  });

  describe('idempotencia do evento nascido na nuvem (indice parcial)', () => {
    it('barra dois overrides com a mesma chave e edgeNodeId NULO', async () => {
      const chave = `override-${randomUUID()}`;

      await db.accessEvent.create({
        data: {
          tenantId: a.tenantId,
          gymUnitId: a.gymUnitId,
          edgeNodeId: null,
          deviceId: a.deviceId,
          studentId: a.studentId,
          outcome: 'ALLOW',
          reason: 'ACTIVE_ENTITLEMENT',
          policyVersion: '1.0.0',
          mode: 'OVERRIDE',
          method: 'MANUAL',
          occurredAt: new Date(),
          correlationId: randomUUID(),
          idempotencyKey: chave,
          detail: {},
        },
      });

      // Sem o indice parcial isto PASSARIA: em Postgres, NULL nunca e igual
      // a NULL, entao o unique composto nao ve conflito nenhum aqui.
      await expect(
        db.accessEvent.create({
          data: {
            tenantId: a.tenantId,
            gymUnitId: a.gymUnitId,
            edgeNodeId: null,
            deviceId: a.deviceId,
            studentId: a.studentId,
            outcome: 'ALLOW',
            reason: 'ACTIVE_ENTITLEMENT',
            policyVersion: '1.0.0',
            mode: 'OVERRIDE',
            method: 'MANUAL',
            occurredAt: new Date(),
            correlationId: randomUUID(),
            idempotencyKey: chave,
            detail: {},
          },
        }),
      ).rejects.toThrow();
    });

    it('a mesma chave em OUTRO tenant nao colide -- o indice e escopado', async () => {
      const chave = `override-cross-${randomUUID()}`;

      const criar = (tenantId: string, gymUnitId: string) =>
        db.accessEvent.create({
          data: {
            tenantId,
            gymUnitId,
            edgeNodeId: null,
            outcome: 'DENY',
            reason: 'NO_ENTITLEMENT',
            policyVersion: '1.0.0',
            mode: 'OVERRIDE',
            method: 'MANUAL',
            occurredAt: new Date(),
            correlationId: randomUUID(),
            idempotencyKey: chave,
            detail: {},
          },
        });

      await criar(a.tenantId, a.gymUnitId);

      await expect(criar(b.tenantId, b.gymUnitId)).resolves.toBeDefined();
    });
  });

  describe('imutabilidade e correcao (M1-BR-009)', () => {
    it('correcao acrescenta linha e deixa o evento original intacto', async () => {
      const { evento } = await eventos.append(eventoBase());
      const antes = { ...evento };

      const { evento: corretor } = await eventos.append(
        eventoBase({ outcome: 'DENY', reason: 'NO_ENTITLEMENT' }),
      );

      await eventos.registrarCorrecao(
        a.tenantId,
        evento.id,
        corretor.id,
        'reconhecimento atribuido ao aluno errado',
        a.actorId,
        randomUUID(),
      );

      const original = await db.accessEvent.findUniqueOrThrow({ where: { id: evento.id } });

      expect(original.outcome).toBe(antes.outcome);
      expect(original.reason).toBe(antes.reason);

      const correcoes = await db.accessEventCorrection.findMany({
        where: { originalEventId: evento.id },
      });

      expect(correcoes).toHaveLength(1);
      expect(correcoes[0]?.correctingEventId).toBe(corretor.id);
    });

    it('o repositorio nao expoe caminho de atualizacao nem remocao', () => {
      const metodos = Object.getOwnPropertyNames(AccessEventRepository.prototype);

      expect(metodos).not.toContain('atualizar');
      expect(metodos).not.toContain('remover');
      expect(metodos).toContain('registrarCorrecao');
    });
  });

  describe('passagem (M1-BR-009)', () => {
    it('evolui de PENDING para CONFIRMED sem tocar no evento', async () => {
      const { evento } = await eventos.append(eventoBase());

      await eventos.registrarPassagem(evento.id, 'PENDING', 'cmd-1', null);
      await eventos.registrarPassagem(evento.id, 'CONFIRMED', 'cmd-1', new Date());

      const passagem = await db.accessPassage.findUniqueOrThrow({
        where: { accessEventId: evento.id },
      });

      expect(passagem.state).toBe('CONFIRMED');
    });

    it('repetir o MESMO desfecho terminal e inofensivo', async () => {
      const { evento } = await eventos.append(eventoBase());

      await eventos.registrarPassagem(evento.id, 'CONFIRMED', 'cmd-2', new Date());

      await expect(
        eventos.registrarPassagem(evento.id, 'CONFIRMED', 'cmd-2', new Date()),
      ).resolves.toBeUndefined();
    });

    it('desfecho terminal DIFERENTE e conflito -- a catraca nao girou e nao girou', async () => {
      const { evento } = await eventos.append(eventoBase());

      await eventos.registrarPassagem(evento.id, 'CONFIRMED', 'cmd-3', new Date());

      await expect(
        eventos.registrarPassagem(evento.id, 'TIMED_OUT', 'cmd-3', new Date()),
      ).rejects.toMatchObject({ response: { code: 'ACCESS_PASSAGE_ALREADY_TERMINAL' } });
    });
  });

  describe('isolamento entre tenants (M1-NFR-007)', () => {
    it('tenant B nao encontra evento de tenant A', async () => {
      const { evento } = await eventos.append(eventoBase());

      const pelaOtica = await eventos.encontrar(b.tenantId, evento.id);

      expect(pelaOtica).toBeNull();
    });

    it('a projecao nao enxerga entitlement de outro tenant', async () => {
      const entrada = await projecao.montarEntrada(
        b.tenantId,
        b.gymUnitId,
        a.studentId,
        'ACTIVE',
        new Date(),
      );

      expect(entrada.entitlements).toHaveLength(0);
    });
  });

  describe('projecao para o motor', () => {
    it('passa SO as janelas da unidade avaliada', async () => {
      const entitlement = await db.entitlement.create({
        data: {
          tenantId: a.tenantId,
          studentId: a.studentId,
          source: 'SUBSCRIPTION',
          status: 'ACTIVE',
          startsAt: new Date(Date.now() - 86_400_000),
          endsAt: new Date(Date.now() + 86_400_000 * 30),
          policySnapshot: {},
        },
      });

      // Mesma faixa horaria nas DUAS unidades, dias diferentes: se a projecao
      // vazar, a janela de sabado da outra unidade aparece nesta.
      await db.entitlementUnitWindow.createMany({
        data: [
          {
            entitlementId: entitlement.id,
            gymUnitId: a.gymUnitId,
            dayOfWeek: 1,
            startMinute: 480,
            endMinute: 1200,
          },
          {
            entitlementId: entitlement.id,
            gymUnitId: a.outraUnidadeId,
            dayOfWeek: 6,
            startMinute: 480,
            endMinute: 1200,
          },
        ],
      });

      const entrada = await projecao.montarEntrada(
        a.tenantId,
        a.gymUnitId,
        a.studentId,
        'ACTIVE',
        new Date(),
      );

      const projetado = entrada.entitlements.find((e) => e.id === entitlement.id);

      expect(projetado).toBeDefined();
      // As DUAS unidades aparecem -- o motor precisa disso para distinguir
      // `WRONG_UNIT` das demais razoes.
      expect([...projetado!.unitIds].sort()).toEqual([a.gymUnitId, a.outraUnidadeId].sort());
      // Mas SO a janela desta unidade.
      expect(projetado!.windows).toEqual([{ dayOfWeek: 1, startMinute: 480, endMinute: 1200 }]);
    });

    it('marca bloqueio administrativo vigente', async () => {
      const bloqueado = await db.student.create({
        data: {
          tenantId: a.tenantId,
          membershipNumber: `M-BLQ-${sufixo}`,
          fullName: 'Aluno Bloqueado',
          birthDate: new Date('1988-03-03T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      });

      await db.administrativeBlock.create({
        data: {
          tenantId: a.tenantId,
          studentId: bloqueado.id,
          reason: 'pendencia disciplinar',
          actorId: a.actorId,
          startsAt: new Date(Date.now() - 3_600_000),
        },
      });

      const entrada = await projecao.montarEntrada(
        a.tenantId,
        a.gymUnitId,
        bloqueado.id,
        'ACTIVE',
        new Date(),
      );

      expect(entrada.adminBlock.active).toBe(true);
    });

    it('bloqueio ja levantado nao conta', async () => {
      const liberado = await db.student.create({
        data: {
          tenantId: a.tenantId,
          membershipNumber: `M-LIB-${sufixo}`,
          fullName: 'Aluno Liberado',
          birthDate: new Date('1988-03-03T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      });

      await db.administrativeBlock.create({
        data: {
          tenantId: a.tenantId,
          studentId: liberado.id,
          reason: 'pendencia resolvida',
          actorId: a.actorId,
          startsAt: new Date(Date.now() - 7_200_000),
          liftedAt: new Date(Date.now() - 3_600_000),
          liftedById: a.actorId,
          liftReason: 'regularizado',
        },
      });

      const entrada = await projecao.montarEntrada(
        a.tenantId,
        a.gymUnitId,
        liberado.id,
        'ACTIVE',
        new Date(),
      );

      expect(entrada.adminBlock.active).toBe(false);
    });

    it('converte o instante para a hora local da unidade', async () => {
      // 17:00Z = 14:00 em Sao Paulo, quarta-feira.
      const entrada = await projecao.montarEntrada(
        a.tenantId,
        a.gymUnitId,
        a.studentId,
        'ACTIVE',
        new Date('2026-08-12T17:00:00.000Z'),
      );

      expect(entrada.localDayOfWeek).toBe(3);
      expect(entrada.localMinuteOfDay).toBe(14 * 60);
    });
  });
});
