import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { AplicarInadimplenciaUseCase } from '../../src/modules/billing/aplicar-inadimplencia.use-case.js';
import { BillingRepository } from '../../src/modules/billing/billing.repository.js';
import { ConsultarMesesPagaveisUseCase } from '../../src/modules/billing/consultar-meses-pagaveis.use-case.js';
import {
  IdempotencyKeyComCorpoDiferenteError,
  RegistrarPagamentoEmLoteUseCase,
  TotalDoLoteDivergenteError,
} from '../../src/modules/billing/registrar-pagamento-em-lote.use-case.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Pagamento em lote no balcao (F83, issue #458): quita, numa transacao so,
 * uma faixa continua de meses vencidos/corrente/adiantados.
 *
 * Contra banco de verdade (`docs/TESTING.md` 3): a atomicidade da transacao,
 * a corrida entre recebimento avulso e lote (Task 2) e a idempotencia por
 * `batchId` sao comportamento real do Postgres -- dublar o banco provaria
 * so a sintaxe do TypeScript.
 */
describe('RegistrarPagamentoEmLoteUseCase', () => {
  let db: PrismaService;
  let billingRepository: BillingRepository;
  let consultarMeses: ConsultarMesesPagaveisUseCase;
  let registrarLote: RegistrarPagamentoEmLoteUseCase;
  let aplicarInadimplencia: AplicarInadimplenciaUseCase;

  const sufixo = randomUUID().slice(0, 8);
  const contexto: TenantContext = {
    tenantId: '',
    // Preenchido no `beforeAll` com um usuario REAL: `audit_logs.actor_id` tem
    // FK para `users`, e um UUID solto viola a constraint (mesmo padrao de
    // `billing-estorno-e-conciliacao.int-spec.ts`).
    actorId: '',
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };

  let unidadeId = '';
  let planoId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    billingRepository = moduleRef.get(BillingRepository);
    consultarMeses = comContextoDeTenant(moduleRef.get(ConsultarMesesPagaveisUseCase));
    registrarLote = comContextoDeTenant(moduleRef.get(RegistrarPagamentoEmLoteUseCase));
    aplicarInadimplencia = comContextoDeTenant(moduleRef.get(AplicarInadimplenciaUseCase));

    const tenant = await db.tenant.create({
      data: {
        slug: `lote-${sufixo}`,
        legalName: `Lote ${sufixo} LTDA`,
        displayName: `Lote ${sufixo}`,
      },
    });
    contexto.tenantId = tenant.id;

    const senhas = moduleRef.get(PasswordService);
    const operador = await db.user.create({
      data: {
        email: `lote-op-${sufixo}@exemplo.test`,
        passwordHash: await senhas.gerarHash('lote-senha-de-teste-nao-usada-em-producao'),
      },
      select: { id: true },
    });
    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: operador.id } });
    contexto.actorId = operador.id;

    await db.billingSettings.create({
      data: { tenantId: tenant.id, dueDay: 9, graceDays: 3 },
    });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'MTZ',
        name: 'Matriz',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    unidadeId = unidade.id;

    const plano = await db.plan.create({
      data: {
        tenantId: tenant.id,
        name: `Plano Lote ${sufixo}`,
        prices: {
          create: [
            {
              tenantId: tenant.id,
              amountMinor: 10000,
              currency: 'BRL',
              validFrom: new Date('2026-01-01T00:00:00Z'),
            },
          ],
        },
      },
      select: { id: true },
    });
    planoId = plano.id;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: contexto.tenantId } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Aluno + assinatura, prontos para abrir invoice em qualquer competencia. */
  async function novaAssinatura(startsAt = '2026-01-01T00:00:00Z'): Promise<{ studentId: string; subscriptionId: string }> {
    const marca = randomUUID().slice(0, 8);
    const aluno = await db.student.create({
      data: {
        tenantId: contexto.tenantId,
        gymUnitId: unidadeId,
        membershipNumber: `LOTE-${marca}`,
        fullName: 'Aluno Lote',
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    const assinatura = await db.subscription.create({
      data: {
        tenantId: contexto.tenantId,
        studentId: aluno.id,
        planId: planoId,
        status: 'ACTIVE',
        startsAt: new Date(startsAt),
      },
      select: { id: true },
    });

    // Entitlement SUSPENSO -- o mesmo estado que a inadimplencia real deixa,
    // e que `ativarDireitoDeAcessoSePendente` precisa achar para promover.
    await db.entitlement.create({
      data: {
        tenantId: contexto.tenantId,
        studentId: aluno.id,
        source: 'SUBSCRIPTION',
        subscriptionId: assinatura.id,
        status: 'SUSPENDED',
        startsAt: new Date(startsAt),
        endsAt: new Date('2099-01-01T00:00:00Z'),
        policySnapshot: {},
        suspendedAt: new Date(startsAt),
      },
    });

    return { studentId: aluno.id, subscriptionId: assinatura.id };
  }

  /** Abre uma invoice OVERDUE de um mes especifico (aluno com atraso). */
  async function invoiceEmAberto(opcoes: {
    subscriptionId: string;
    studentId: string;
    competencia: string;
    dueAt: string;
    status?: 'OPEN' | 'OVERDUE';
    totalMinor?: number;
  }): Promise<string> {
    const invoice = await db.invoice.create({
      data: {
        tenantId: contexto.tenantId,
        subscriptionId: opcoes.subscriptionId,
        studentId: opcoes.studentId,
        billingPeriod: new Date(opcoes.competencia),
        number: Math.floor(Math.random() * 1_000_000),
        status: opcoes.status ?? 'OVERDUE',
        currency: 'BRL',
        subtotalMinor: opcoes.totalMinor ?? 10000,
        totalMinor: opcoes.totalMinor ?? 10000,
        dueAt: new Date(opcoes.dueAt),
      },
      select: { id: true },
    });

    return invoice.id;
  }

  /** Meses da faixa do mais antigo ate `ate`, sem dispensa, com a data de hoje como dia do pagamento. */
  async function pagarAte(subscriptionId: string, agora: Date, ate: Date) {
    const faixa = await consultarMeses.executar(contexto, subscriptionId, agora);
    const indice = faixa.findIndex((m) => m.competencia.getTime() === ate.getTime());

    return {
      competencias: faixa.slice(0, indice + 1).map((m) => m.competencia),
      dispensar: [] as Date[],
      paidAt: new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate())),
    };
  }

  async function totalDoLote(subscriptionId: string, agora: Date, ateCompetencia: Date): Promise<number> {
    const faixa = await consultarMeses.executar(contexto, subscriptionId, agora);
    const indice = faixa.findIndex((m) => m.competencia.getTime() === ateCompetencia.getTime());

    return faixa.slice(0, indice + 1).reduce((soma, mes) => soma + mes.totalMinor, 0);
  }

  it('deve 2 meses, paga ate corrente+2: 5 invoices PAID, 5 Payments com mesmo batchId, assinatura e entitlement ACTIVE', async () => {
    const { studentId, subscriptionId } = await novaAssinatura('2026-06-01T00:00:00Z');
    const AGORA = new Date('2026-09-15T12:00:00.000Z');

    await invoiceEmAberto({
      subscriptionId,
      studentId,
      competencia: '2026-07-01T00:00:00Z',
      dueAt: '2026-07-09T00:00:00Z',
    });
    await invoiceEmAberto({
      subscriptionId,
      studentId,
      competencia: '2026-08-01T00:00:00Z',
      dueAt: '2026-08-09T00:00:00Z',
    });

    // corrente (set) + 2 adiantados (out, nov) -- total de 5 meses: jul, ago,
    // set, out, nov.
    const ateCompetencia = new Date('2026-11-01T00:00:00Z');
    const expectedTotalMinor = await totalDoLote(subscriptionId, AGORA, ateCompetencia);
    expect(expectedTotalMinor).toBe(50000);

    const resultado = await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        ...(await pagarAte(subscriptionId, AGORA, ateCompetencia)),
        channel: 'DINHEIRO',
        expectedTotalMinor,
        idempotencyKey: randomUUID(),
        agora: AGORA,
      },
      'corr-lote-feliz',
    );

    expect(resultado.invoiceIds).toHaveLength(5);
    expect(resultado.totalMinor).toBe(50000);

    const invoices = await db.invoice.findMany({ where: { subscriptionId, tenantId: contexto.tenantId } });
    // 5 pagas; o lote nao abre a fatura seguinte (F88).
    expect(invoices).toHaveLength(5);
    expect(invoices.filter((i) => i.status === 'PAID')).toHaveLength(5);
    expect(invoices.filter((i) => i.status === 'OPEN')).toHaveLength(0);

    const payments = await db.payment.findMany({ where: { tenantId: contexto.tenantId, batchId: resultado.batchId } });
    expect(payments).toHaveLength(5);
    expect(new Set(payments.map((p) => p.batchId)).size).toBe(1);

    const assinatura = await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(assinatura.status).toBe('ACTIVE');

    const entitlement = await db.entitlement.findFirstOrThrow({ where: { subscriptionId } });
    expect(entitlement.status).toBe('ACTIVE');
  });

  const diaUtc = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

  async function aluno2MesesAtrasados(): Promise<{ studentId: string; subscriptionId: string; jul: string; ago: string }> {
    const { studentId, subscriptionId } = await novaAssinatura('2026-06-01T00:00:00Z');
    const jul = await invoiceEmAberto({ subscriptionId, studentId, competencia: '2026-07-01T00:00:00Z', dueAt: '2026-07-09T00:00:00Z' });
    const ago = await invoiceEmAberto({ subscriptionId, studentId, competencia: '2026-08-01T00:00:00Z', dueAt: '2026-08-09T00:00:00Z' });

    return { studentId, subscriptionId, jul, ago };
  }

  it('escolha LIVRE: paga so setembro e julho/agosto continuam em aberto, sem obrigar o mes anterior', async () => {
    const { subscriptionId, jul, ago } = await aluno2MesesAtrasados();
    const AGORA = new Date('2026-09-15T12:00:00.000Z');

    const resultado = await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        competencias: [new Date('2026-09-01T00:00:00Z')],
        dispensar: [],
        paidAt: diaUtc('2026-09-15'),
        channel: 'DINHEIRO',
        expectedTotalMinor: 10000,
        idempotencyKey: randomUUID(),
        agora: AGORA,
      },
      'corr-livre',
    );

    expect(resultado.invoiceIds).toHaveLength(1);
    const pagas = await db.invoice.findMany({ where: { subscriptionId, status: 'PAID' } });
    expect(pagas.map((i) => i.billingPeriod.toISOString().slice(0, 7))).toEqual(['2026-09']);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: jul } })).status).toBe('OVERDUE');
    expect((await db.invoice.findUniqueOrThrow({ where: { id: ago } })).status).toBe('OVERDUE');
  });

  it('DISPENSAR: mes anterior nao usado vira CANCELLED e sai da inadimplencia; o outro segue em aberto', async () => {
    const { subscriptionId, jul, ago } = await aluno2MesesAtrasados();

    await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        competencias: [new Date('2026-09-01T00:00:00Z')],
        dispensar: [new Date('2026-07-01T00:00:00Z')],
        paidAt: diaUtc('2026-09-15'),
        channel: 'DINHEIRO',
        expectedTotalMinor: 10000,
        idempotencyKey: randomUUID(),
        agora: new Date('2026-09-15T12:00:00.000Z'),
      },
      'corr-dispensa',
    );

    expect((await db.invoice.findUniqueOrThrow({ where: { id: jul } })).status).toBe('CANCELLED');
    expect((await db.invoice.findUniqueOrThrow({ where: { id: ago } })).status).toBe('OVERDUE');
    const auditoria = await db.auditLog.count({ where: { tenantId: contexto.tenantId, action: 'billing.invoice.dispensed', targetId: jul } });
    expect(auditoria).toBe(1);
  });

  it('DATA DO PAGAMENTO nao mexe na fatura seguinte: ela segue no dia do ciclo (F88)', async () => {
    const { studentId, subscriptionId } = await novaAssinatura('2026-06-01T00:00:00Z');
    await invoiceEmAberto({ subscriptionId, studentId, competencia: '2026-09-01T00:00:00Z', dueAt: '2026-09-09T00:00:00Z', status: 'OPEN' });
    await invoiceEmAberto({ subscriptionId, studentId, competencia: '2026-10-01T00:00:00Z', dueAt: '2026-10-09T00:00:00Z', status: 'OPEN' });

    await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        competencias: [new Date('2026-09-01T00:00:00Z')],
        dispensar: [],
        paidAt: diaUtc('2026-09-10'),
        channel: 'DINHEIRO',
        expectedTotalMinor: 10000,
        idempotencyKey: randomUUID(),
        agora: new Date('2026-09-15T12:00:00.000Z'),
      },
      'corr-sem-ancora',
    );

    const pagamento = await db.payment.findFirstOrThrow({ where: { tenantId: contexto.tenantId, invoice: { subscriptionId } } });
    expect(pagamento.paidAt!.toISOString()).toBe('2026-09-10T12:00:00.000Z');

    const outubro = await db.invoice.findUniqueOrThrow({
      where: { tenantId_subscriptionId_billingPeriod: { tenantId: contexto.tenantId, subscriptionId, billingPeriod: new Date('2026-10-01T00:00:00Z') } },
    });
    expect(outubro.dueAt.toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });

  it('F88: cobertura escalonada -- pago 07/10 out+nov+dez cobre 06/11, 06/12, 05/01', async () => {
    const { subscriptionId } = await novaAssinatura('2026-06-01T00:00:00Z');

    await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        competencias: [new Date('2026-12-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z')],
        dispensar: [],
        paidAt: diaUtc('2026-10-07'),
        channel: 'PIX',
        expectedTotalMinor: 30000,
        idempotencyKey: randomUUID(),
        agora: new Date('2026-10-07T15:00:00.000Z'),
      },
      'corr-cobertura',
    );

    const faturas = await db.invoice.findMany({
      where: { tenantId: contexto.tenantId, subscriptionId },
      orderBy: { billingPeriod: 'asc' },
      select: { billingPeriod: true, coverageEndsAt: true, dueAt: true },
    });
    expect(faturas.map((f) => f.coverageEndsAt?.toISOString().slice(0, 10))).toEqual(['2026-11-06', '2026-12-06', '2027-01-05']);
    // Vencimento intocado: dia do ciclo (dueDay do cenario).
    expect(faturas.map((f) => f.dueAt.toISOString().slice(8, 10))).toEqual(['09', '09', '09']);
  });

  it('o lote NAO abre a fatura do mes seguinte ao ultimo pago (F88)', async () => {
    const { subscriptionId } = await novaAssinatura('2026-06-01T00:00:00Z');

    await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        competencias: [new Date('2026-09-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z')],
        dispensar: [],
        paidAt: diaUtc('2026-09-15'),
        channel: 'DINHEIRO',
        expectedTotalMinor: 20000,
        idempotencyKey: randomUUID(),
        agora: new Date('2026-09-15T12:00:00.000Z'),
      },
      'corr-sem-seguinte',
    );

    const novembro = await db.invoice.findUnique({
      where: { tenantId_subscriptionId_billingPeriod: { tenantId: contexto.tenantId, subscriptionId, billingPeriod: new Date('2026-11-01T00:00:00Z') } },
    });
    expect(novembro).toBeNull();
  });

  it('mes JA PAGO some da faixa e nao pode ser pago de novo', async () => {
    const { subscriptionId } = await novaAssinatura('2026-06-01T00:00:00Z');
    const AGORA = new Date('2026-10-01T15:00:00.000Z');
    const entrada = {
      subscriptionId,
      competencias: [new Date('2026-10-01T00:00:00Z')],
      dispensar: [] as Date[],
      paidAt: diaUtc('2026-10-01'),
      channel: 'DINHEIRO' as const,
      expectedTotalMinor: 10000,
      agora: AGORA,
    };

    await registrarLote.executar(contexto, { ...entrada, idempotencyKey: randomUUID() }, 'corr-pago-1');

    const faixa = await consultarMeses.executar(contexto, subscriptionId, AGORA);
    expect(faixa.map((m) => m.competencia.toISOString().slice(0, 7))).not.toContain('2026-10');

    await expect(
      registrarLote.executar(contexto, { ...entrada, idempotencyKey: randomUUID() }, 'corr-pago-2'),
    ).rejects.toMatchObject({ code: 'BILLING_BATCH_OUT_OF_RANGE' });
  });

  it('fatura em aberto presa a assinatura CANCELADA aparece na faixa, e pagar reativa a assinatura ativa', async () => {
    // Caso real de set/2026 (7 alunos): duplicata consolidada deixou a fatura
    // de setembro na assinatura antiga, e a ativa nao tinha fatura do mes.
    const { studentId, subscriptionId } = await novaAssinatura('2026-09-01T00:00:00Z');
    const antiga = await db.subscription.create({
      data: {
        tenantId: contexto.tenantId,
        studentId,
        planId: planoId,
        status: 'CANCELLED',
        startsAt: new Date('2026-08-27T00:00:00Z'),
        endsAt: new Date('2026-09-26T00:00:00Z'),
      },
      select: { id: true },
    });
    const faturaAntiga = await invoiceEmAberto({
      subscriptionId: antiga.id,
      studentId,
      competencia: '2026-09-01T00:00:00Z',
      dueAt: '2026-09-09T00:00:00Z',
      status: 'OPEN',
    });
    await db.subscription.update({ where: { id: subscriptionId }, data: { status: 'PAST_DUE' } });

    const AGORA = new Date('2026-10-01T15:00:00.000Z');
    const faixa = await consultarMeses.executar(contexto, subscriptionId, AGORA);
    const setembro = faixa.find((m) => m.competencia.toISOString().slice(0, 7) === '2026-09');

    expect(setembro).toMatchObject({ status: 'OPEN', invoiceId: faturaAntiga });

    await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        competencias: [new Date('2026-09-01T00:00:00Z')],
        dispensar: [],
        paidAt: diaUtc('2026-10-01'),
        channel: 'DINHEIRO',
        expectedTotalMinor: 10000,
        idempotencyKey: randomUUID(),
        agora: AGORA,
      },
      'corr-assinatura-antiga',
    );

    expect((await db.invoice.findUniqueOrThrow({ where: { id: faturaAntiga } })).status).toBe('PAID');
    expect((await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })).status).toBe('ACTIVE');
    expect((await db.entitlement.findFirstOrThrow({ where: { subscriptionId } })).status).toBe('ACTIVE');
  });

  it('fatura da assinatura ATIVA vence a de outra assinatura na mesma competencia (nao cobra o mes duas vezes)', async () => {
    const { studentId, subscriptionId } = await novaAssinatura('2026-09-01T00:00:00Z');
    const antiga = await db.subscription.create({
      data: {
        tenantId: contexto.tenantId,
        studentId,
        planId: planoId,
        status: 'CANCELLED',
        startsAt: new Date('2026-08-27T00:00:00Z'),
        endsAt: new Date('2026-09-26T00:00:00Z'),
      },
      select: { id: true },
    });
    await invoiceEmAberto({ subscriptionId: antiga.id, studentId, competencia: '2026-09-01T00:00:00Z', dueAt: '2026-09-09T00:00:00Z', status: 'OPEN' });
    const daAtiva = await invoiceEmAberto({ subscriptionId, studentId, competencia: '2026-09-01T00:00:00Z', dueAt: '2026-09-09T00:00:00Z', status: 'OPEN' });

    const faixa = await consultarMeses.executar(contexto, subscriptionId, new Date('2026-10-01T15:00:00.000Z'));
    const setembros = faixa.filter((m) => m.competencia.toISOString().slice(0, 7) === '2026-09');

    expect(setembros).toHaveLength(1);
    expect(setembros[0]!.invoiceId).toBe(daAtiva);
  });

  it('data de pagamento FUTURA e recusada', async () => {
    const { subscriptionId } = await novaAssinatura('2026-06-01T00:00:00Z');

    await expect(
      registrarLote.executar(
        contexto,
        {
          subscriptionId,
          competencias: [new Date('2026-09-01T00:00:00Z')],
          dispensar: [],
          paidAt: diaUtc('2026-09-16'),
          channel: 'DINHEIRO',
          expectedTotalMinor: 10000,
          idempotencyKey: randomUUID(),
          agora: new Date('2026-09-15T12:00:00.000Z'),
        },
        'corr-futura',
      ),
    ).rejects.toMatchObject({ code: 'BILLING_PAID_AT_IN_FUTURE' });
  });

  it('mesma Idempotency-Key com DATA diferente e recusada (corpo mudou)', async () => {
    const { subscriptionId } = await novaAssinatura('2026-06-01T00:00:00Z');
    const idempotencyKey = randomUUID();
    const base = {
      subscriptionId,
      competencias: [new Date('2026-09-01T00:00:00Z')],
      dispensar: [] as Date[],
      channel: 'DINHEIRO' as const,
      expectedTotalMinor: 10000,
      idempotencyKey,
      agora: new Date('2026-09-15T12:00:00.000Z'),
    };

    await registrarLote.executar(contexto, { ...base, paidAt: diaUtc('2026-09-10') }, 'corr-data-1');

    await expect(
      registrarLote.executar(contexto, { ...base, paidAt: diaUtc('2026-09-12') }, 'corr-data-2'),
    ).rejects.toMatchObject({ code: 'BILLING_BATCH_IDEMPOTENCY_MISMATCH' });
  });

  it('mesma Idempotency-Key + mesmo corpo repetido: nenhum Payment novo, devolve resultado anterior', async () => {
    const { studentId, subscriptionId } = await novaAssinatura('2026-06-01T00:00:00Z');
    const AGORA = new Date('2026-09-15T12:00:00.000Z');

    // Lote de PELO MENOS 3 meses (jul, ago, set) -- nao 1: com um lote de um
    // mes so, `invoiceIds` do replay bater com o da primeira chamada nao
    // prova nada alem do batchId ecoado (achado da revisao, fix round 1).
    await invoiceEmAberto({
      subscriptionId,
      studentId,
      competencia: '2026-07-01T00:00:00Z',
      dueAt: '2026-07-09T00:00:00Z',
    });
    await invoiceEmAberto({
      subscriptionId,
      studentId,
      competencia: '2026-08-01T00:00:00Z',
      dueAt: '2026-08-09T00:00:00Z',
    });

    const ateCompetencia = new Date('2026-09-01T00:00:00Z');
    const expectedTotalMinor = await totalDoLote(subscriptionId, AGORA, ateCompetencia);
    expect(expectedTotalMinor).toBe(30000);
    const idempotencyKey = randomUUID();

    const entrada = {
      subscriptionId,
      ...(await pagarAte(subscriptionId, AGORA, ateCompetencia)),
      channel: 'DINHEIRO' as const,
      expectedTotalMinor,
      idempotencyKey,
      agora: AGORA,
    };

    const primeira = await registrarLote.executar(contexto, entrada, 'corr-idem-1');
    const contagemAntes = await db.payment.count({ where: { tenantId: contexto.tenantId, batchId: idempotencyKey } });

    const segunda = await registrarLote.executar(contexto, entrada, 'corr-idem-2');
    const contagemDepois = await db.payment.count({ where: { tenantId: contexto.tenantId, batchId: idempotencyKey } });

    expect(contagemDepois).toBe(contagemAntes);
    expect(primeira.invoiceIds).toHaveLength(3);
    // Deep-equal do CONTEUDO, nao so do batchId (que e trivialmente igual
    // por ser o eco da propria chave).
    expect(segunda.batchId).toBe(primeira.batchId);
    expect(segunda.invoiceIds).toEqual(primeira.invoiceIds);
    expect(segunda.totalMinor).toBe(primeira.totalMinor);
  });

  it('mesma Idempotency-Key + mesmo corpo, mas subscriptionId DIFERENTE: 422, nunca devolve o lote do outro aluno', async () => {
    const { studentId: studentA, subscriptionId: subscriptionA } = await novaAssinatura('2026-08-01T00:00:00Z');
    const { subscriptionId: subscriptionB } = await novaAssinatura('2026-08-01T00:00:00Z');
    const AGORA = new Date('2026-09-15T12:00:00.000Z');

    await invoiceEmAberto({
      subscriptionId: subscriptionA,
      studentId: studentA,
      competencia: '2026-09-01T00:00:00Z',
      dueAt: '2026-09-09T00:00:00Z',
      status: 'OPEN',
    });

    const ateCompetencia = new Date('2026-09-01T00:00:00Z');
    const expectedTotalMinor = await totalDoLote(subscriptionA, AGORA, ateCompetencia);
    const idempotencyKey = randomUUID();

    const resultadoA = await registrarLote.executar(
      contexto,
      {
        subscriptionId: subscriptionA,
        ...(await pagarAte(subscriptionA, AGORA, ateCompetencia)),
        channel: 'DINHEIRO',
        expectedTotalMinor,
        idempotencyKey,
        agora: AGORA,
      },
      'corr-cruzado-1',
    );

    // MESMA chave, MESMOS meses/channel/expectedTotalMinor -- so o
    // subscriptionId muda. Sem o subscriptionId no hash, isto devolveria o
    // lote do aluno A como se fosse sucesso para o aluno B (achado da
    // revisao, fix round 1).
    await expect(
      registrarLote.executar(
        contexto,
        {
          subscriptionId: subscriptionB,
          ...(await pagarAte(subscriptionB, AGORA, ateCompetencia)),
          channel: 'DINHEIRO',
          expectedTotalMinor,
          idempotencyKey,
          agora: AGORA,
        },
        'corr-cruzado-2',
      ),
    ).rejects.toBeInstanceOf(IdempotencyKeyComCorpoDiferenteError);

    const paymentsDoB = await db.payment.findMany({
      where: { tenantId: contexto.tenantId, invoice: { subscriptionId: subscriptionB } },
    });
    expect(paymentsDoB).toHaveLength(0);

    // O aluno A continua com o resultado dele, intocado.
    const paymentsDoA = await db.payment.findMany({ where: { tenantId: contexto.tenantId, batchId: resultadoA.batchId } });
    expect(paymentsDoA.every((p) => p.invoiceId !== paymentsDoB[0]?.invoiceId)).toBe(true);
  });

  it('mesma Idempotency-Key + corpo diferente: 422, nada gravado', async () => {
    const { studentId, subscriptionId } = await novaAssinatura('2026-08-01T00:00:00Z');
    const AGORA = new Date('2026-09-15T12:00:00.000Z');

    await invoiceEmAberto({
      subscriptionId,
      studentId,
      competencia: '2026-09-01T00:00:00Z',
      dueAt: '2026-09-09T00:00:00Z',
      status: 'OPEN',
    });

    const idempotencyKey = randomUUID();
    const setembro = new Date('2026-09-01T00:00:00Z');
    const totalSetembro = await totalDoLote(subscriptionId, AGORA, setembro);

    await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        ...(await pagarAte(subscriptionId, AGORA, setembro)),
        channel: 'DINHEIRO',
        expectedTotalMinor: totalSetembro,
        idempotencyKey,
        agora: AGORA,
      },
      'corr-mismatch-1',
    );

    const contagemAntes = await db.payment.count({ where: { tenantId: contexto.tenantId, batchId: idempotencyKey } });
    const invoiceCountAntes = await db.invoice.count({ where: { subscriptionId, tenantId: contexto.tenantId } });

    const outubro = new Date('2026-10-01T00:00:00Z');
    const totalOutubro = await totalDoLote(subscriptionId, AGORA, outubro);

    await expect(
      registrarLote.executar(
        contexto,
        {
          subscriptionId,
          ...(await pagarAte(subscriptionId, AGORA, outubro)),
          channel: 'DINHEIRO',
          expectedTotalMinor: totalOutubro,
          idempotencyKey,
          agora: AGORA,
        },
        'corr-mismatch-2',
      ),
    ).rejects.toBeInstanceOf(IdempotencyKeyComCorpoDiferenteError);

    const contagemDepois = await db.payment.count({ where: { tenantId: contexto.tenantId, batchId: idempotencyKey } });
    const invoiceCountDepois = await db.invoice.count({ where: { subscriptionId, tenantId: contexto.tenantId } });

    expect(contagemDepois).toBe(contagemAntes);
    expect(invoiceCountDepois).toBe(invoiceCountAntes);
  });

  /*
   * Regressao direta da correcao da Task 2: duas chamadas concorrentes sobre
   * a MESMA invoice -- um recebimento avulso via `registrarPagamentoManual` e
   * um lote de um mes so -- disputam o MESMO `updateMany` condicionado.
   *
   * DISPARAR AS DUAS PROMISES ANTES DE QUALQUER UMA RESOLVER NAO BASTA (achado
   * da revisao, fix round 1): o lote faz 4 leituras SEQUENCIAIS fora da
   * transacao antes de entrar nela (lookup de idempotencia, assinatura,
   * config, invoices abertas -- `registrar-pagamento-em-lote.use-case.ts`
   * linhas ~70-110). Dependendo de quem "vence" essas leituras, o teste podia
   * nunca chegar a exercitar o `updateMany` condicionado -- podia falhar antes,
   * por `LoteInvalidoError` ou por `TransicaoDeInvoiceInvalidaError` na
   * checagem pre-transacao. Isso e o padrao "canario passa por guarda
   * anterior" da memoria do projeto: um teste que passa mesmo revertendo a
   * correcao real.
   *
   * FIX: uma barreira controlada por spy. O avulso so entra na CORRIDA de
   * verdade depois que o lote ja passou pelas leituras pre-transacao e esta
   * prestes a chamar `registrarPagamentoManual` de dentro da propria
   * transacao -- momento em que o spy libera o avulso. Isso garante que os
   * dois cheguem ao `updateMany` quase ao mesmo tempo, exercitando a guarda
   * de verdade (nao uma guarda anterior).
   */
  it('recebimento avulso e lote concorrentes sobre a mesma invoice: so um transiciona para PAID', async () => {
    const { studentId, subscriptionId } = await novaAssinatura('2026-07-01T00:00:00Z');
    const AGORA = new Date('2026-08-01T12:00:00.000Z');

    const invoiceId = await invoiceEmAberto({
      subscriptionId,
      studentId,
      competencia: '2026-07-01T00:00:00Z',
      dueAt: '2026-07-09T00:00:00Z',
    });

    const julho = new Date('2026-07-01T00:00:00Z');
    const totalJulho = await totalDoLote(subscriptionId, AGORA, julho);

    // Barreira: o avulso so dispara quando o lote sinaliza que ja esta
    // dentro da propria transacao, prestes a chamar `registrarPagamentoManual`.
    let liberarAvulso: () => void = () => {};
    const loteChegouNaTransacao = new Promise<void>((resolve) => {
      liberarAvulso = resolve;
    });

    const original = billingRepository.registrarPagamentoManual.bind(billingRepository);
    jest
      .spyOn(billingRepository, 'registrarPagamentoManual')
      .mockImplementation(async (...args: Parameters<typeof original>) => {
        liberarAvulso();
        return original(...args);
      });

    const promiseLote = registrarLote.executar(
      contexto,
      {
        subscriptionId,
        ...(await pagarAte(subscriptionId, AGORA, julho)),
        channel: 'PIX',
        expectedTotalMinor: totalJulho,
        idempotencyKey: randomUUID(),
        agora: AGORA,
      },
      'corr-lote-concorrente',
    );

    const promiseAvulso = loteChegouNaTransacao.then(() =>
      billingRepository.registrarPagamentoManual(
        contexto,
        {
          invoiceId,
          amountMinor: totalJulho,
          reason: 'recebimento avulso concorrente',
          paidAt: AGORA,
          receivedVia: 'DINHEIRO',
        },
        'corr-avulso-concorrente',
      ),
    );

    const resultados = await Promise.allSettled([promiseAvulso, promiseLote]);

    const sucessos = resultados.filter((r) => r.status === 'fulfilled');
    const falhas = resultados.filter((r) => r.status === 'rejected');

    expect(sucessos).toHaveLength(1);
    expect(falhas).toHaveLength(1);

    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.status).toBe('PAID');

    const pagamentosConfirmados = await db.payment.findMany({
      where: { tenantId: contexto.tenantId, invoiceId, status: 'CONFIRMED' },
    });
    expect(pagamentosConfirmados).toHaveLength(1);
  });

  it('expectedTotalMinor divergente do total calculado: 409, nada gravado', async () => {
    const { studentId, subscriptionId } = await novaAssinatura('2026-08-01T00:00:00Z');
    const AGORA = new Date('2026-09-15T12:00:00.000Z');

    await invoiceEmAberto({
      subscriptionId,
      studentId,
      competencia: '2026-09-01T00:00:00Z',
      dueAt: '2026-09-09T00:00:00Z',
      status: 'OPEN',
    });

    const setembro = new Date('2026-09-01T00:00:00Z');
    const totalReal = await totalDoLote(subscriptionId, AGORA, setembro);

    const invoiceCountAntes = await db.invoice.count({ where: { subscriptionId, tenantId: contexto.tenantId } });
    const paymentCountAntes = await db.payment.count({ where: { tenantId: contexto.tenantId } });

    await expect(
      registrarLote.executar(
        contexto,
        {
          subscriptionId,
          ...(await pagarAte(subscriptionId, AGORA, setembro)),
          channel: 'DINHEIRO',
          expectedTotalMinor: Math.floor(totalReal / 2),
          idempotencyKey: randomUUID(),
          agora: AGORA,
        },
        'corr-total-divergente',
      ),
    ).rejects.toBeInstanceOf(TotalDoLoteDivergenteError);

    const invoiceCountDepois = await db.invoice.count({ where: { subscriptionId, tenantId: contexto.tenantId } });
    const paymentCountDepois = await db.payment.count({ where: { tenantId: contexto.tenantId } });

    expect(invoiceCountDepois).toBe(invoiceCountAntes);
    expect(paymentCountDepois).toBe(paymentCountAntes);
  });

  /*
   * ADR-027 resposta 1 ("pagamento parcial nao existe") vale para o lote
   * exatamente como ja vale para invoice unica (`aplicarPagamento` em
   * `domain/invoice.ts`, usado por `registrarPagamentoManual`). Sem esta
   * guarda, `receivedAmountMinor < totalCalculado` silenciosamente pagava o
   * valor cheio de cada invoice mesmo o operador tendo recebido menos
   * (achado da revisao, fix round 1).
   */
  it('receivedAmountMinor menor que o total calculado: rejeita, nada gravado (sem subpagamento silencioso)', async () => {
    const { studentId, subscriptionId } = await novaAssinatura('2026-08-01T00:00:00Z');
    const AGORA = new Date('2026-09-15T12:00:00.000Z');

    await invoiceEmAberto({
      subscriptionId,
      studentId,
      competencia: '2026-09-01T00:00:00Z',
      dueAt: '2026-09-09T00:00:00Z',
      status: 'OPEN',
    });

    const setembro = new Date('2026-09-01T00:00:00Z');
    const totalReal = await totalDoLote(subscriptionId, AGORA, setembro);

    const invoiceCountAntes = await db.invoice.count({ where: { subscriptionId, tenantId: contexto.tenantId } });
    const paymentCountAntes = await db.payment.count({ where: { tenantId: contexto.tenantId } });

    await expect(
      registrarLote.executar(
        contexto,
        {
          subscriptionId,
          ...(await pagarAte(subscriptionId, AGORA, setembro)),
          channel: 'DINHEIRO',
          expectedTotalMinor: totalReal,
          receivedAmountMinor: totalReal - 1,
          idempotencyKey: randomUUID(),
          agora: AGORA,
        },
        'corr-subpagamento',
      ),
    ).rejects.toMatchObject({ code: 'BILLING_INVALID_INVOICE' });

    const invoiceCountDepois = await db.invoice.count({ where: { subscriptionId, tenantId: contexto.tenantId } });
    const paymentCountDepois = await db.payment.count({ where: { tenantId: contexto.tenantId } });

    expect(invoiceCountDepois).toBe(invoiceCountAntes);
    expect(paymentCountDepois).toBe(paymentCountAntes);
  });

  /*
   * Mecanismo de falha ESCOLHIDO (desvio documentado do brief, que sugeria
   * mock/spy OU dado real invalido): um `jest.spyOn` sobre
   * `BillingRepository.registrarPagamentoManual`, chamando a implementacao
   * REAL nas duas primeiras invocacoes (passando o MESMO `tx` adiante -- e
   * o que faz o teste continuar dentro da transacao do lote) e lancando um
   * `Error` generico na terceira. Fabricar uma violacao de constraint real
   * (FK ou unique) no terceiro mes exigiria estado corrompido tao artificial
   * quanto o proprio spy, sem provar nada a mais sobre o Prisma -- e o
   * `jest.spyOn` ja e o padrao estabelecido neste repositorio para simular
   * falha no meio de um fluxo (`checkout-de-cartao.int-spec.ts`).
   */
  it('falha plantada no terceiro mes desfaz os dois primeiros (atomicidade)', async () => {
    const { subscriptionId } = await novaAssinatura('2026-09-01T00:00:00Z');
    const AGORA = new Date('2026-09-15T12:00:00.000Z');

    // Sem nada em aberto: NOT_OPENED em set, out, nov -- 3 meses novos.
    const novembro = new Date('2026-11-01T00:00:00Z');
    const totalEsperado = await totalDoLote(subscriptionId, AGORA, novembro);

    let chamadas = 0;
    const original = billingRepository.registrarPagamentoManual.bind(billingRepository);
    jest
      .spyOn(billingRepository, 'registrarPagamentoManual')
      .mockImplementation(async (...args: Parameters<typeof original>) => {
        chamadas += 1;
        if (chamadas === 3) {
          throw new Error('falha plantada no terceiro mes (teste de atomicidade)');
        }
        return original(...args);
      });

    await expect(
      registrarLote.executar(
        contexto,
        {
          subscriptionId,
          ...(await pagarAte(subscriptionId, AGORA, novembro)),
          channel: 'DINHEIRO',
          expectedTotalMinor: totalEsperado,
          idempotencyKey: randomUUID(),
          agora: AGORA,
        },
        'corr-atomicidade',
      ),
    ).rejects.toThrow('falha plantada no terceiro mes');

    const invoices = await db.invoice.findMany({ where: { subscriptionId, tenantId: contexto.tenantId } });
    expect(invoices).toHaveLength(0);

    const payments = await db.payment.count({ where: { tenantId: contexto.tenantId, invoice: { subscriptionId } } });
    expect(payments).toBe(0);
  });

  it('job de inadimplencia rodado depois nao suspende quem pagou adiantado', async () => {
    const { studentId, subscriptionId } = await novaAssinatura('2026-08-01T00:00:00Z');
    const AGORA = new Date('2026-09-15T12:00:00.000Z');

    await invoiceEmAberto({
      subscriptionId,
      studentId,
      competencia: '2026-09-01T00:00:00Z',
      dueAt: '2026-09-09T00:00:00Z',
      status: 'OPEN',
    });

    // corrente (set) + 2 adiantados (out, nov).
    const novembro = new Date('2026-11-01T00:00:00Z');
    const totalEsperado = await totalDoLote(subscriptionId, AGORA, novembro);

    await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        ...(await pagarAte(subscriptionId, AGORA, novembro)),
        channel: 'DINHEIRO',
        expectedTotalMinor: totalEsperado,
        idempotencyKey: randomUUID(),
        agora: AGORA,
      },
      'corr-adiantado',
    );

    // "Agora" um mes depois -- so as invoices futuras (out, nov) estariam
    // vencidas se nao estivessem PAID; o job nao deve achar nada OPEN/OVERDUE
    // para suspender.
    const umMesDepois = new Date('2026-10-20T12:00:00.000Z');
    await aplicarInadimplencia.executar(contexto.tenantId, umMesDepois);

    const assinatura = await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(assinatura.status).toBe('ACTIVE');

    const entitlement = await db.entitlement.findFirstOrThrow({ where: { subscriptionId } });
    expect(entitlement.status).toBe('ACTIVE');
  });

  it('tenant B nao enxerga assinatura do tenant A', async () => {
    const { subscriptionId } = await novaAssinatura('2026-08-01T00:00:00Z');

    const tenantB = await db.tenant.create({
      data: { slug: `lote-b-${sufixo}`, legalName: `Lote B ${sufixo} LTDA`, displayName: `Lote B ${sufixo}` },
    });

    try {
      const contextoB: TenantContext = { ...contexto, tenantId: tenantB.id };

      await expect(
        registrarLote.executar(
          contextoB,
          {
            subscriptionId,
            ...(await pagarAte(subscriptionId, new Date('2026-09-15T12:00:00.000Z'), new Date('2026-09-01T00:00:00Z'))),
            channel: 'DINHEIRO',
            expectedTotalMinor: 10000,
            idempotencyKey: randomUUID(),
            agora: new Date('2026-09-15T12:00:00.000Z'),
          },
          'corr-cross-tenant',
        ),
      ).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_FOUND' });
    } finally {
      await db.tenant.delete({ where: { id: tenantB.id } });
    }
  });
});
