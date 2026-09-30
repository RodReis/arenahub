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

    const operador = await db.user.create({
      data: {
        email: `lote-op-${sufixo}@exemplo.test`,
        passwordHash: 'hash-de-teste-nao-usado-em-producao',
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
        ateCompetencia,
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
    expect(invoices).toHaveLength(5);
    expect(invoices.every((i) => i.status === 'PAID')).toBe(true);

    const payments = await db.payment.findMany({ where: { tenantId: contexto.tenantId, batchId: resultado.batchId } });
    expect(payments).toHaveLength(5);
    expect(new Set(payments.map((p) => p.batchId)).size).toBe(1);

    const assinatura = await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(assinatura.status).toBe('ACTIVE');

    const entitlement = await db.entitlement.findFirstOrThrow({ where: { subscriptionId } });
    expect(entitlement.status).toBe('ACTIVE');
  });

  it('mesma Idempotency-Key + mesmo corpo repetido: nenhum Payment novo, devolve resultado anterior', async () => {
    const { studentId, subscriptionId } = await novaAssinatura('2026-08-01T00:00:00Z');
    const AGORA = new Date('2026-09-15T12:00:00.000Z');

    await invoiceEmAberto({
      subscriptionId,
      studentId,
      competencia: '2026-09-01T00:00:00Z',
      dueAt: '2026-09-09T00:00:00Z',
      status: 'OPEN',
    });

    const ateCompetencia = new Date('2026-09-01T00:00:00Z');
    const expectedTotalMinor = await totalDoLote(subscriptionId, AGORA, ateCompetencia);
    const idempotencyKey = randomUUID();

    const entrada = {
      subscriptionId,
      ateCompetencia,
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
    expect(segunda.batchId).toBe(primeira.batchId);
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
        ateCompetencia: setembro,
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
          ateCompetencia: outubro,
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
   * um lote de um mes so -- disputam o MESMO `updateMany` condicionado. Para
   * ser corrida de verdade (nao sequencial-parecendo-paralela), as duas
   * promises comecam ANTES de qualquer uma resolver.
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

    const promiseAvulso = billingRepository.registrarPagamentoManual(
      contexto,
      {
        invoiceId,
        amountMinor: totalJulho,
        reason: 'recebimento avulso concorrente',
        paidAt: AGORA,
        receivedVia: 'DINHEIRO',
      },
      'corr-avulso-concorrente',
    );

    const promiseLote = registrarLote.executar(
      contexto,
      {
        subscriptionId,
        ateCompetencia: julho,
        channel: 'PIX',
        expectedTotalMinor: totalJulho,
        idempotencyKey: randomUUID(),
        agora: AGORA,
      },
      'corr-lote-concorrente',
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
          ateCompetencia: setembro,
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
          ateCompetencia: novembro,
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
        ateCompetencia: novembro,
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
            ateCompetencia: new Date('2026-09-01T00:00:00Z'),
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
