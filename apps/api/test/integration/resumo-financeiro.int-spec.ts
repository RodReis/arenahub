import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';

import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { ConsultarResumoFinanceiroUseCase } from '../../src/modules/billing/consultar-resumo-financeiro.use-case.js';
import { JanelaDoResumoInvalidaError } from '../../src/modules/billing/domain/resumo-financeiro.js';
import { AppModule } from '../../src/app.module.js';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F54 -- painel financeiro gerencial (`SPEC-054`).
 *
 * ISOLAMENTO ENTRE TENANTS e o teste que mais importa: e uma rota que
 * CONSOLIDA o tenant inteiro, sem filtro de aluno. Sem `tenantId` no `where`
 * de cada agregacao, ela soma o faturamento de todas as academias num numero
 * so -- e o numero PARECE plausivel, que e o que torna essa falha cara.
 *
 * Cada `it` semeia o proprio tenant, pelo mesmo motivo do
 * `listar-invoices.int-spec.ts`: num resumo que soma tudo, tenant
 * compartilhado faz o total de um teste incluir o que o anterior deixou.
 */
describe('ConsultarResumoFinanceiroUseCase', () => {
  let db: PrismaService;
  let useCase: ConsultarResumoFinanceiroUseCase;

  const sufixo = randomUUID().slice(0, 8);
  const tenantIdsCriados: string[] = [];
  const actorIdsCriados: string[] = [];
  let numero = 0;

  /** Janela de agosto/2026, fechada. `ate` EXCLUSIVO. */
  const DE = new Date('2026-08-01T00:00:00.000Z');
  const ATE = new Date('2026-09-01T00:00:00.000Z');
  const AGORA = new Date('2026-09-15T12:00:00.000Z');

  interface Semente {
    contexto: TenantContext;
    subscriptionId: string;
    studentId: string;
    planId: string;
  }

  async function semearTenant(opts: { precoMinor?: number } = {}): Promise<Semente> {
    const rotulo = randomUUID().slice(0, 8);

    const tenant = await db.tenant.create({
      data: {
        slug: `f54-resumo-${rotulo}-${sufixo}`,
        legalName: `F54 Resumo ${rotulo} ${sufixo} LTDA`,
        displayName: `F54 Resumo ${rotulo} ${sufixo}`,
      },
    });
    tenantIdsCriados.push(tenant.id);

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: `UNI-${rotulo}`,
        name: 'Unidade da fixture',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const operador = await db.user.create({
      data: { email: `op-resumo-${rotulo}@arena.test`, passwordHash: 'x'.repeat(60) },
    });
    actorIdsCriados.push(operador.id);
    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: operador.id } });

    const plano = await db.plan.create({ data: { tenantId: tenant.id, name: `Plano ${rotulo}` } });

    await db.planPrice.create({
      data: {
        tenantId: tenant.id,
        planId: plano.id,
        amountMinor: opts.precoMinor ?? 15_000,
        currency: 'BRL',
        validFrom: new Date('2026-01-01T00:00:00Z'),
      },
    });

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        fullName: `Aluno ${rotulo}`,
        membershipNumber: `M-${rotulo}`,
        birthDate: new Date('1990-05-20T00:00:00Z'),
        status: 'ACTIVE',
      },
    });

    const assinatura = await db.subscription.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        planId: plano.id,
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00Z'),
      },
    });

    return {
      contexto: {
        tenantId: tenant.id,
        actorId: operador.id,
        sessionId: randomUUID(),
        permissions: new Set(['billing.dashboard']),
        allowedUnitIds: 'ALL',
      },
      subscriptionId: assinatura.id,
      studentId: aluno.id,
      planId: plano.id,
    };
  }

  async function criarInvoice(
    s: Semente,
    opts: {
      status?: 'DRAFT' | 'OPEN' | 'PAID' | 'OVERDUE' | 'CANCELLED';
      dueAt?: Date;
      competencia?: string;
      totalMinor?: number;
    } = {},
  ): Promise<string> {
    numero += 1;
    const anoBase = 2000 + Math.floor(numero / 12);
    const mesBase = 1 + (numero % 12);

    const invoice = await db.invoice.create({
      data: {
        tenantId: s.contexto.tenantId,
        subscriptionId: s.subscriptionId,
        studentId: s.studentId,
        billingPeriod: new Date(
          `${opts.competencia ?? `${anoBase}-${String(mesBase).padStart(2, '0')}`}-01T00:00:00Z`,
        ),
        number: numero,
        status: opts.status ?? 'OPEN',
        currency: 'BRL',
        subtotalMinor: opts.totalMinor ?? 10_000,
        totalMinor: opts.totalMinor ?? 10_000,
        dueAt: opts.dueAt ?? new Date('2026-08-10T00:00:00Z'),
      },
      select: { id: true },
    });

    return invoice.id;
  }

  /**
   * Outro aluno e outra assinatura DENTRO do mesmo tenant.
   *
   * Existe para os testes que precisam de duas invoices na MESMA competencia:
   * a unique de INV-066 so permite uma por assinatura.
   */
  async function outraAssinaturaDoMesmoTenant(s: Semente): Promise<Semente> {
    const rotulo = randomUUID().slice(0, 8);

    const unidade = await db.gymUnit.findFirstOrThrow({
      where: { tenantId: s.contexto.tenantId },
      select: { id: true },
    });

    const aluno = await db.student.create({
      data: {
        tenantId: s.contexto.tenantId,
        gymUnitId: unidade.id,
        fullName: `Aluno ${rotulo}`,
        membershipNumber: `M-${rotulo}`,
        birthDate: new Date('1990-05-20T00:00:00Z'),
        status: 'ACTIVE',
      },
    });

    const assinatura = await db.subscription.create({
      data: {
        tenantId: s.contexto.tenantId,
        studentId: aluno.id,
        planId: s.planId,
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00Z'),
      },
    });

    return { ...s, studentId: aluno.id, subscriptionId: assinatura.id };
  }

  async function criarPagamento(
    s: Semente,
    invoiceId: string,
    opts: {
      status?: 'PENDING' | 'CONFIRMED' | 'FAILED';
      paidAt?: Date;
      amountMinor?: number;
      method?: 'MANUAL' | 'PIX' | 'CARD';
    } = {},
  ): Promise<string> {
    const pagamento = await db.payment.create({
      data: {
        tenantId: s.contexto.tenantId,
        invoiceId,
        amountMinor: opts.amountMinor ?? 10_000,
        currency: 'BRL',
        method: opts.method ?? 'MANUAL',
        status: opts.status ?? 'CONFIRMED',
        paidAt: opts.paidAt ?? new Date('2026-08-10T12:00:00Z'),
      },
      select: { id: true },
    });

    return pagamento.id;
  }

  async function criarEstorno(
    s: Semente,
    invoiceId: string,
    paymentId: string,
    opts: { amountMinor: number; settledAt?: Date; status?: 'CONFIRMED' | 'REQUESTED' | 'FAILED' },
  ): Promise<void> {
    await db.refund.create({
      data: {
        tenantId: s.contexto.tenantId,
        invoiceId,
        paymentId,
        amountMinor: opts.amountMinor,
        currency: 'BRL',
        status: opts.status ?? 'CONFIRMED',
        reason: 'teste de fixture',
        requestedByUserId: s.contexto.actorId,
        idempotencyKey: randomUUID(),
        settledAt: opts.settledAt ?? new Date('2026-08-20T12:00:00Z'),
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    useCase = moduleRef.get(ConsultarResumoFinanceiroUseCase);
  });

  afterEach(async () => {
    await db.tenant.deleteMany({ where: { id: { in: tenantIdsCriados.splice(0) } } });
    await db.user.deleteMany({ where: { id: { in: actorIdsCriados.splice(0) } } });
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: tenantIdsCriados.splice(0) } } });
    await db.user.deleteMany({ where: { id: { in: actorIdsCriados.splice(0) } } });
  });

  /**
   * O TESTE NAO-NEGOCIAVEL desta rota. Dois tenants com dinheiro, e o resumo
   * de um nao pode enxergar um centavo do outro.
   *
   * Os valores sao DIFERENTES de proposito: com valores iguais, um `where`
   * sem `tenantId` daria o dobro e alguem poderia ler como "dois pagamentos",
   * e nao como vazamento.
   */
  it('nao soma o dinheiro de outro tenant', async () => {
    const meu = await semearTenant();
    const outro = await semearTenant();

    const minhaInvoice = await criarInvoice(meu);
    await criarPagamento(meu, minhaInvoice, { amountMinor: 10_000 });

    const invoiceAlheia = await criarInvoice(outro);
    await criarPagamento(outro, invoiceAlheia, { amountMinor: 77_000 });

    const resumo = await useCase.executar(meu.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.recebidoMinor).toBe(10_000);
    expect(resumo.pagamentosConfirmados).toBe(1);
    expect(resumo.base.alunosPagantes).toBe(1);
  });

  it('soma apenas pagamentos CONFIRMED', async () => {
    const s = await semearTenant();
    const invoice = await criarInvoice(s);

    await criarPagamento(s, invoice, { status: 'CONFIRMED', amountMinor: 10_000 });
    await criarPagamento(s, invoice, { status: 'PENDING', amountMinor: 50_000 });
    await criarPagamento(s, invoice, { status: 'FAILED', amountMinor: 90_000 });

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.recebidoMinor).toBe(10_000);
    expect(resumo.pagamentosConfirmados).toBe(1);
  });

  /**
   * A JANELA E `[de, ate)` -- `ate` EXCLUSIVO.
   *
   * O pagamento no primeiro instante de setembro NAO e de agosto. Com `<=`,
   * ele entraria nos dois meses e a soma dos periodos ultrapassaria o total
   * recebido no ano.
   */
  it('recorta o recebido pela janela, com o fim exclusivo', async () => {
    const s = await semearTenant();
    const invoice = await criarInvoice(s);

    await criarPagamento(s, invoice, { paidAt: DE, amountMinor: 1_000 });
    await criarPagamento(s, invoice, {
      paidAt: new Date('2026-08-31T23:59:59.999Z'),
      amountMinor: 2_000,
    });
    // Fora: primeiro instante do mes seguinte.
    await criarPagamento(s, invoice, { paidAt: ATE, amountMinor: 4_000 });
    // Fora: antes do inicio.
    await criarPagamento(s, invoice, {
      paidAt: new Date('2026-07-31T23:59:59.999Z'),
      amountMinor: 8_000,
    });

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.recebidoMinor).toBe(3_000);
    expect(resumo.pagamentosConfirmados).toBe(2);
  });

  it('quebra o recebido por metodo, com metodo sem movimento em zero', async () => {
    const s = await semearTenant();
    const invoice = await criarInvoice(s);

    await criarPagamento(s, invoice, { method: 'PIX', amountMinor: 30_000 });
    await criarPagamento(s, invoice, { method: 'PIX', amountMinor: 20_000 });
    await criarPagamento(s, invoice, { method: 'MANUAL', amountMinor: 5_000 });

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.quebraPorMetodo).toEqual([
      { metodo: 'MANUAL', minorTotal: 5_000, quantidade: 1 },
      { metodo: 'PIX', minorTotal: 50_000, quantidade: 2 },
      // CARD sem movimento aparece zerado -- a tela precisa das tres fatias
      // para a quebra somar 100%, e nao de duas com a terceira sumindo.
      { metodo: 'CARD', minorTotal: 0, quantidade: 0 },
    ]);
  });

  /**
   * O DEFEITO QUE ESTE TESTE EXISTE PARA IMPEDIR, achado em revisao.
   *
   * ESTORNO PARCIAL NAO MEXE NO `Payment`: o `EstornarPagamentoUseCase` so
   * move o pagamento para `REFUNDED` quando o estorno e TOTAL. Um pagamento
   * de R$ 150 estornado em R$ 90 continua `CONFIRMED` com `amountMinor` 150 --
   * e a primeira versao desta fatia somava exatamente isso.
   *
   * O dono leria que entraram R$ 150 quando entraram R$ 60. E o terceiro
   * defeito de dinheiro do projeto com a mesma assinatura: o estado do
   * registro nao conta a historia inteira.
   */
  it('desconta estorno parcial do recebido, com o pagamento ainda CONFIRMED', async () => {
    const s = await semearTenant();
    const invoice = await criarInvoice(s);
    const pagamento = await criarPagamento(s, invoice, { amountMinor: 15_000 });

    await criarEstorno(s, invoice, pagamento, { amountMinor: 9_000 });

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    // O pagamento NAO mudou de estado -- e o que torna o defeito invisivel.
    const depois = await db.payment.findUniqueOrThrow({
      where: { id: pagamento },
      select: { status: true, amountMinor: true },
    });
    expect(depois).toEqual({ status: 'CONFIRMED', amountMinor: 15_000 });

    expect(resumo.recebidoMinor).toBe(6_000);
    expect(resumo.estornadoMinor).toBe(9_000);
  });

  /** Estorno nao confirmado NAO abate: o dinheiro ainda nao saiu. */
  it('ignora estorno que ainda nao foi confirmado', async () => {
    const s = await semearTenant();
    const invoice = await criarInvoice(s);
    const pagamento = await criarPagamento(s, invoice, { amountMinor: 15_000 });

    await criarEstorno(s, invoice, pagamento, { amountMinor: 9_000, status: 'REQUESTED' });
    await criarEstorno(s, invoice, pagamento, { amountMinor: 5_000, status: 'FAILED' });

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.recebidoMinor).toBe(15_000);
    expect(resumo.estornadoMinor).toBe(0);
  });

  /**
   * O ESTORNO ABATE NO PERIODO EM QUE O DINHEIRO SAIU (`settledAt`), nao no do
   * pagamento original -- senao um mes ja fechado mudaria de valor semanas
   * depois, que e o que a janela fechada existe para impedir.
   */
  it('abate o estorno na janela em que foi liquidado, nao na do pagamento', async () => {
    const s = await semearTenant();
    const invoice = await criarInvoice(s);
    const pagamento = await criarPagamento(s, invoice, {
      paidAt: new Date('2026-08-10T12:00:00Z'),
      amountMinor: 15_000,
    });

    // Liquidado em SETEMBRO: agosto nao pode encolher.
    await criarEstorno(s, invoice, pagamento, {
      amountMinor: 9_000,
      settledAt: new Date('2026-09-05T12:00:00Z'),
    });

    const agosto = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });
    expect(agosto.recebidoMinor).toBe(15_000);
    expect(agosto.estornadoMinor).toBe(0);

    const setembro = await useCase.executar(s.contexto, {
      de: ATE,
      ate: new Date('2026-10-01T00:00:00.000Z'),
      agora: new Date('2026-10-02T00:00:00.000Z'),
    });
    // Sem entrada no mes, o liquido vai a ZERO e nao a negativo -- "recebi
    // menos noventa reais" nao e leitura util. O estorno aparece ao lado.
    expect(setembro.recebidoMinor).toBe(0);
    expect(setembro.estornadoMinor).toBe(9_000);
  });

  /**
   * DECISAO 3 DO PI: receita esperada vem do PLANO matriculado, nao da soma
   * das invoices emitidas.
   *
   * O teste prova a diferenca: o tenant tem UMA invoice de R$ 100 e uma
   * assinatura de um plano de R$ 150. Se a implementacao somasse invoices, o
   * numero seria 10.000.
   */
  it('calcula receita esperada pelo preco vigente do plano, nao pelas invoices', async () => {
    const s = await semearTenant({ precoMinor: 15_000 });
    await criarInvoice(s, { totalMinor: 10_000 });

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.receitaEsperadaMinor).toBe(15_000);
  });

  /**
   * REAJUSTE AGENDADO ja aparece na expectativa antes de ser cobrado -- e o
   * que o dono quer ver ao decidir o reajuste. `precoVigenteEm` escolhe o
   * `validFrom` mais recente que ja comecou.
   */
  it('usa o preco vigente hoje quando ha reajuste no historico', async () => {
    const s = await semearTenant({ precoMinor: 15_000 });

    await db.planPrice.create({
      data: {
        tenantId: s.contexto.tenantId,
        planId: s.planId,
        amountMinor: 18_000,
        currency: 'BRL',
        validFrom: new Date('2026-09-01T00:00:00Z'),
      },
    });

    // Reajuste FUTURO nao pode ser escolhido: ainda nao vigora em `agora`.
    await db.planPrice.create({
      data: {
        tenantId: s.contexto.tenantId,
        planId: s.planId,
        amountMinor: 25_000,
        currency: 'BRL',
        validFrom: new Date('2027-01-01T00:00:00Z'),
      },
    });

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.receitaEsperadaMinor).toBe(18_000);
  });

  /**
   * VENCIDO NAO E RECORTADO PELA JANELA -- e a excecao deliberada do use
   * case. Divida de junho continua faltando em agosto.
   *
   * Este teste falha se alguem "consertar" a inconsistencia aparente
   * aplicando a janela ao vencido: o numero encolheria sem ninguem ter pago.
   */
  it('conta como vencido a divida anterior a janela', async () => {
    const s = await semearTenant();

    await criarInvoice(s, { status: 'OVERDUE', dueAt: new Date('2026-06-10T00:00:00Z') });
    await criarInvoice(s, { status: 'OPEN', dueAt: new Date('2026-08-10T00:00:00Z') });

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.faturasVencidas).toBe(2);
    expect(resumo.vencidoMinor).toBe(20_000);
  });

  /**
   * A SOMA DAS BARRAS TEM DE BATER COM O TOTAL. Se uma invoice escapar da
   * escada, o grafico contradiz o numero ao lado.
   */
  it('classifica toda invoice vencida em exatamente uma faixa', async () => {
    const s = await semearTenant();

    // Em relacao a AGORA (15/09): 5, 20, 45 e 100 dias de atraso.
    await criarInvoice(s, { dueAt: new Date('2026-09-10T00:00:00Z') });
    await criarInvoice(s, { dueAt: new Date('2026-08-26T00:00:00Z') });
    await criarInvoice(s, { dueAt: new Date('2026-08-01T00:00:00Z') });
    await criarInvoice(s, { dueAt: new Date('2026-06-07T00:00:00Z') });

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.faixas).toEqual([
      { rotulo: 'Até 15 dias', minorTotal: 10_000, quantidade: 1 },
      { rotulo: '16 a 30 dias', minorTotal: 10_000, quantidade: 1 },
      { rotulo: '31 a 60 dias', minorTotal: 10_000, quantidade: 1 },
      { rotulo: 'Mais de 60 dias', minorTotal: 10_000, quantidade: 1 },
    ]);

    const somaDasBarras = resumo.faixas.reduce((soma, f) => soma + f.minorTotal, 0);
    expect(somaDasBarras).toBe(resumo.vencidoMinor);
  });

  /**
   * A SERIE ATRIBUI O PAGAMENTO A COMPETENCIA DA INVOICE, nao ao mes em que o
   * dinheiro entrou (`SPEC-054` §3.1).
   *
   * O caso: aluno paga a fatura de JUNHO em agosto. Junho tem de fechar --
   * agosto inflar faria o gestor achar que teve um mes bom.
   */
  it('atribui o recebido a competencia da invoice, nao a data do pagamento', async () => {
    const s = await semearTenant();

    const deJunho = await criarInvoice(s, { competencia: '2026-06', status: 'PAID' });
    await criarPagamento(s, deJunho, {
      paidAt: new Date('2026-08-20T00:00:00Z'),
      amountMinor: 10_000,
    });

    const resumo = await useCase.executar(s.contexto, {
      de: new Date('2026-06-01T00:00:00.000Z'),
      ate: new Date('2026-07-01T00:00:00.000Z'),
      agora: AGORA,
    });

    expect(resumo.serie.pontos).toEqual([
      { competencia: '2026-06', faturadoMinor: 10_000, recebidoMinor: 10_000 },
    ]);
  });

  /**
   * A COMPETENCIA E `YYYY-MM` LIDA EM UTC, e o teste existe por causa do bug
   * de um dia que a F53 ja produziu: `billingPeriod` e `@db.Date` gravado a
   * meia-noite UTC, e `getMonth()` no fuso do servidor (America/Sao_Paulo,
   * UTC-3) devolveria o mes ANTERIOR.
   */
  it('nao desloca a competencia para o mes anterior por causa do fuso', async () => {
    const s = await semearTenant();
    await criarInvoice(s, { competencia: '2026-08' });

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.serie.pontos.map((p) => p.competencia)).toEqual(['2026-08']);
  });

  /**
   * Invoice DRAFT nao foi emitida; CANCELLED deixou de valer. Nem uma nem
   * outra fatura.
   *
   * AS TRES VAO EM ASSINATURAS DIFERENTES por exigencia do banco, nao por
   * gosto: a unique `(tenant_id, subscription_id, billing_period)` (INV-066)
   * PROIBE duas invoices da mesma competencia na mesma assinatura -- e a
   * primeira versao deste teste pedia exatamente isso, e quebrou. A regra que
   * derrubou a fixture e a mesma que impede cobrar o aluno duas vezes pelo
   * mesmo mes.
   */
  it('exclui DRAFT e CANCELLED do faturado da serie', async () => {
    const s = await semearTenant();
    const emDraft = await outraAssinaturaDoMesmoTenant(s);
    const cancelada = await outraAssinaturaDoMesmoTenant(s);

    await criarInvoice(s, { competencia: '2026-08', status: 'OPEN', totalMinor: 10_000 });
    await criarInvoice(emDraft, { competencia: '2026-08', status: 'DRAFT', totalMinor: 99_000 });
    await criarInvoice(cancelada, {
      competencia: '2026-08',
      status: 'CANCELLED',
      totalMinor: 55_000,
    });

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.serie.pontos).toEqual([
      { competencia: '2026-08', faturadoMinor: 10_000, recebidoMinor: 0 },
    ]);
  });

  /**
   * O RISCO DA `SPEC-054` §5.1, contra o banco: um mes de dado nao vira
   * linha. E o estado em que a base real nasce hoje.
   */
  it('marca a serie como insuficiente para linha com um mes de dado', async () => {
    const s = await semearTenant();
    await criarInvoice(s, { competencia: '2026-08' });

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.serie.pontos).toHaveLength(1);
    expect(resumo.serie.suficienteParaLinha).toBe(false);
  });

  /**
   * AUSENCIA NUNCA E ZERO. Tenant sem movimento algum tem ticket medio e taxa
   * NULOS -- a tela desenha `—`, e nao "R$ 0,00" nem "0%".
   */
  it('devolve ticket medio nulo quando nao houve pagamento', async () => {
    const s = await semearTenant();
    await criarInvoice(s);

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.recebidoMinor).toBe(0);
    expect(resumo.ticketMedioMinor).toBeNull();
  });

  it('declara a base sobre a qual calcula', async () => {
    const s = await semearTenant();
    await criarInvoice(s, { status: 'OVERDUE', dueAt: new Date('2026-07-10T00:00:00Z') });

    const resumo = await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    expect(resumo.base).toEqual({
      alunosPagantes: 1,
      alunosInadimplentes: 1,
      assinaturasAtivas: 1,
    });
    expect(resumo.taxaDeInadimplencia).toBe(100);
  });

  /** A janela em curso e recusada na porta -- ver `validarJanela`. */
  it('recusa janela que ainda nao fechou', async () => {
    const s = await semearTenant();

    await expect(
      useCase.executar(s.contexto, {
        de: DE,
        ate: new Date('2026-10-01T00:00:00.000Z'),
        agora: AGORA,
      }),
    ).rejects.toThrow(JanelaDoResumoInvalidaError);
  });

  /**
   * O painel NAO ESCREVE (`SPEC-054` §6). Nenhuma invoice muda de status por
   * alguem ter aberto a tela -- e o mesmo cuidado do painel de inadimplencia.
   */
  it('nao escreve nada: invoice vencida continua OPEN depois da consulta', async () => {
    const s = await semearTenant();
    const id = await criarInvoice(s, { status: 'OPEN', dueAt: new Date('2026-06-10T00:00:00Z') });

    await useCase.executar(s.contexto, { de: DE, ate: ATE, agora: AGORA });

    const depois = await db.invoice.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    expect(depois.status).toBe('OPEN');
  });
});
