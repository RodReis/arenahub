import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { ConciliarMovimentosUseCase } from '../../src/modules/billing/conciliar-movimentos.use-case.js';
import {
  LimiteDeEstornoExcedidoError,
  PagamentoManualNaoEstornavelError,
} from '../../src/modules/billing/domain/estorno.js';
import { EmitirReciboUseCase } from '../../src/modules/billing/emitir-recibo.use-case.js';
import { EstornarPagamentoUseCase } from '../../src/modules/billing/estornar-pagamento.use-case.js';
import {
  FakePaymentProvider,
  PROVEDOR_FAKE,
} from '../../src/modules/billing/provider/fake-payment-provider.adapter.js';
import { PAYMENT_PROVIDER } from '../../src/modules/billing/provider/payment-provider.port.js';
import { ResolverDivergenciaUseCase } from '../../src/modules/billing/resolver-divergencia.use-case.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F16 -- estorno, conciliacao e operacao (Slice 2.5).
 *
 * ACEITE DA SLICE, palavra por palavra: "operador resolve divergencia sem
 * editar banco e sem duplicar efeito financeiro". Mais `M2-AC-009` ("refund
 * segue politica, preserva historico e e conciliado") e `M2-AC-010`.
 *
 * CONTRA BANCO DE VERDADE (`docs/TESTING.md` §3), e nao por preferencia: a
 * exclusao mutua do estorno em voo e um INDICE PARCIAL do Postgres, a
 * numeracao do recibo e um lock pessimista, e a idempotencia da conciliacao e
 * uma constraint. Dublar o banco provaria o `where` do TypeScript, nao a
 * garantia -- foi exatamente esse engano que deixou a F14 cobrar em dobro.
 */
describe('F16 -- estorno, conciliacao e recibo', () => {
  let db: PrismaService;
  let estornar: EstornarPagamentoUseCase;
  let conciliar: ConciliarMovimentosUseCase;
  let resolver: ResolverDivergenciaUseCase;
  let recibo: EmitirReciboUseCase;
  let provedor: FakePaymentProvider;
  let senhas: PasswordService;

  const sufixo = randomUUID().slice(0, 8);
  const contexto: TenantContext = {
    tenantId: '',
    // Preenchido no `beforeAll` com um usuario REAL: `audit_logs.actor_id` tem
    // FK para `users`, e um UUID solto viola a constraint -- que e justamente
    // a garantia de que a trilha aponta para alguem que existe.
    actorId: '',
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };

  const CONTA_EXTERNA = `ACC-PIX-${sufixo}`;
  const PAGO_EM = new Date('2026-08-10T12:00:00.000Z');
  /**
   * Depois de TODAS as janelas usadas na suite: a conciliacao recusa periodo
   * em curso, e um `agora` anterior ao fim da janela reprovaria os casos por
   * um motivo que nao e o que eles testam.
   */
  const AGORA = new Date('2026-12-05T12:00:00.000Z');
  /**
   * Janela EXCLUSIVA dos testes de conciliacao, separada da dos de estorno.
   *
   * Sem separar, os estornos confirmados pelos casos anteriores entram no
   * nosso lado da janela de agosto e o extrato do duble nao os traz -- cada
   * teste de estorno somaria um `MISSING_EXTERNAL` a contagem, e o caso
   * "zero divergencia" passaria a depender de quantos testes rodaram antes.
   */
  const JANELA_CONC = {
    de: new Date('2026-10-01T00:00:00Z'),
    ate: new Date('2026-11-01T00:00:00Z'),
  };
  const PAGO_EM_CONC = new Date('2026-10-10T12:00:00.000Z');

  let studentId = '';
  let subscriptionId = '';
  let providerAccountId = '';
  let periodo = 0;

  /**
   * Competencia unica por invoice.
   *
   * INV-066 exige `(tenant, assinatura, competencia)` unico, e um contador que
   * volta ao mes 1 depois de doze invoices colidiria -- a suite quebraria a
   * partir do decimo terceiro caso, por um motivo que nao tem nada a ver com
   * o que ela testa. Avanca em meses a partir de 2026-01, sem voltar.
   */
  function competenciaUnica(indice: number): Date {
    const ano = 2026 + Math.floor(indice / 12);
    const mes = (indice % 12) + 1;

    return new Date(`${ano}-${String(mes).padStart(2, '0')}-01T00:00:00Z`);
  }

  /**
   * Cria invoice paga com pagamento confirmado, do lado do banco E do lado do
   * provedor -- as duas pontas que a conciliacao compara.
   */
  async function pagamentoConfirmado(
    valorMinor = 12_000,
    quando: Date = PAGO_EM,
  ): Promise<{ paymentId: string; invoiceId: string; externalPaymentId: string }> {
    periodo += 1;

    const cobranca = await provedor.createPix({
      externalAccountId: CONTA_EXTERNA,
      amountMinor: valorMinor,
      currency: 'BRL',
      idempotencyKey: `pix:${sufixo}:${periodo}`,
      expiresAt: quando,
      descricao: 'Mensalidade',
    });
    provedor.simularMudancaDeStatus(cobranca.externalPaymentId, 'CONFIRMED', quando);

    const invoice = await db.invoice.create({
      data: {
        tenantId: contexto.tenantId,
        subscriptionId,
        studentId,
        billingPeriod: competenciaUnica(periodo),
        number: periodo,
        status: 'PAID',
        currency: 'BRL',
        subtotalMinor: valorMinor,
        totalMinor: valorMinor,
        dueAt: quando,
        paidAt: quando,
        items: {
          create: {
            tenantId: contexto.tenantId,
            description: 'Mensalidade',
            quantity: 1,
            unitAmountMinor: valorMinor,
            totalMinor: valorMinor,
          },
        },
      },
      select: { id: true },
    });

    const pagamento = await db.payment.create({
      data: {
        tenantId: contexto.tenantId,
        invoiceId: invoice.id,
        amountMinor: valorMinor,
        currency: 'BRL',
        method: 'PIX',
        status: 'CONFIRMED',
        paidAt: quando,
        // Id EXTERNO, nao o UUID interno: e o que casa com o extrato.
        providerAccountId: CONTA_EXTERNA,
        externalPaymentId: cobranca.externalPaymentId,
      },
      select: { id: true },
    });

    return {
      paymentId: pagamento.id,
      invoiceId: invoice.id,
      externalPaymentId: cobranca.externalPaymentId,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    senhas = moduleRef.get(PasswordService);
    estornar = moduleRef.get(EstornarPagamentoUseCase);
    conciliar = moduleRef.get(ConciliarMovimentosUseCase);
    resolver = moduleRef.get(ResolverDivergenciaUseCase);
    recibo = moduleRef.get(EmitirReciboUseCase);
    provedor = moduleRef.get(PAYMENT_PROVIDER);

    const tenant = await db.tenant.create({
      data: {
        slug: `f16-${sufixo}`,
        legalName: `F16 ${sufixo} LTDA`,
        displayName: `F16 ${sufixo}`,
      },
    });
    contexto.tenantId = tenant.id;

    const operador = await db.user.create({
      data: {
        email: `f16-op-${sufixo}@exemplo.test`,
        passwordHash: await senhas.gerarHash('f16-senha-de-teste-nao-usada-em-producao'),
      },
      select: { id: true },
    });
    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: operador.id } });
    contexto.actorId = operador.id;

    await db.billingSettings.create({
      data: { tenantId: tenant.id, dueDay: 10, graceDays: 3 },
    });

    const conta = await db.providerAccount.create({
      data: {
        tenantId: tenant.id,
        provider: PROVEDOR_FAKE,
        capability: 'PIX',
        externalAccountId: CONTA_EXTERNA,
        signingSecretEncrypted: 'nao-sai-deste-arquivo',
      },
      select: { id: true },
    });
    providerAccountId = conta.id;
    provedor.registrarConta(CONTA_EXTERNA, 'segredo-de-teste');

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'MTZ',
        name: 'Matriz',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        membershipNumber: `M-${sufixo}`,
        fullName: 'Aluno F16',
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    studentId = aluno.id;

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Plano F16 ${sufixo}` },
      select: { id: true },
    });

    const assinatura = await db.subscription.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        planId: plano.id,
        status: 'ACTIVE',
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
      select: { id: true },
    });
    subscriptionId = assinatura.id;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: contexto.tenantId } });
  });

  describe('estorno', () => {
    it('estorno total marca pagamento e invoice como REFUNDED -- a invoice NAO reabre', async () => {
      const { paymentId, invoiceId } = await pagamentoConfirmado();

      const resultado = await estornar.executar(
        contexto,
        { paymentId, amountMinor: 12_000, reason: 'aluno desistiu', agora: AGORA },
        'corr-1',
      );

      expect(resultado.status).toBe('CONFIRMED');

      const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      const pagamento = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });

      // INV-069: reabrir diria que o aluno nunca pagou, e ele pagou.
      expect(invoice.status).toBe('REFUNDED');
      expect(invoice.status).not.toBe('OPEN');
      expect(pagamento.status).toBe('REFUNDED');
    });

    it('KEEP_UNTIL_PERIOD_END nao suspende o acesso -- decisao do PI', async () => {
      const { paymentId } = await pagamentoConfirmado();

      const entitlement = await db.entitlement.create({
        data: {
          tenantId: contexto.tenantId,
          studentId,
          subscriptionId,
          source: 'SUBSCRIPTION',
          status: 'ACTIVE',
          startsAt: new Date('2026-08-01T00:00:00Z'),
          endsAt: new Date('2026-09-30T00:00:00Z'),
          policySnapshot: {},
        },
        select: { id: true },
      });

      const resultado = await estornar.executar(
        contexto,
        { paymentId, amountMinor: 12_000, reason: 'estorno com politica padrao', agora: AGORA },
        'corr-2',
      );

      expect(resultado.acessoSuspenso).toBe(false);
      expect(resultado.politicaDeAcesso).toBe('KEEP_UNTIL_PERIOD_END');

      const depois = await db.entitlement.findUniqueOrThrow({ where: { id: entitlement.id } });
      expect(depois.status).toBe('ACTIVE');

      await db.entitlement.delete({ where: { id: entitlement.id } });
    });

    it('SUSPEND_ON_CONFIRMATION suspende agora, e a politica aplicada fica gravada', async () => {
      await db.billingSettings.update({
        where: { tenantId: contexto.tenantId },
        data: { refundAccessPolicy: 'SUSPEND_ON_CONFIRMATION' },
      });

      const { paymentId } = await pagamentoConfirmado();
      const entitlement = await db.entitlement.create({
        data: {
          tenantId: contexto.tenantId,
          studentId,
          subscriptionId,
          source: 'SUBSCRIPTION',
          status: 'ACTIVE',
          startsAt: new Date('2026-08-01T00:00:00Z'),
          endsAt: new Date('2026-09-30T00:00:00Z'),
          policySnapshot: {},
        },
        select: { id: true },
      });

      const resultado = await estornar.executar(
        contexto,
        { paymentId, amountMinor: 12_000, reason: 'estorno com suspensao', agora: AGORA },
        'corr-3',
      );

      expect(resultado.acessoSuspenso).toBe(true);

      const depois = await db.entitlement.findUniqueOrThrow({ where: { id: entitlement.id } });
      expect(depois.status).toBe('SUSPENDED');

      /**
       * A politica fica COPIADA no estorno, nao referenciada: a pergunta "por
       * que este aluno perdeu o acesso?" tem de ser respondivel com o valor
       * que valia naquele dia, mesmo depois de o tenant mudar de politica.
       */
      const refund = await db.refund.findFirstOrThrow({ where: { id: resultado.refundId } });
      expect(refund.appliedAccessPolicy).toBe('SUSPEND_ON_CONFIRMATION');

      await db.entitlement.delete({ where: { id: entitlement.id } });
      await db.billingSettings.update({
        where: { tenantId: contexto.tenantId },
        data: { refundAccessPolicy: 'KEEP_UNTIL_PERIOD_END' },
      });
    });

    it('estorno parcial NAO muda a invoice -- parte do dinheiro entrou mesmo', async () => {
      const { paymentId, invoiceId } = await pagamentoConfirmado();

      await estornar.executar(
        contexto,
        { paymentId, amountMinor: 4_000, reason: 'estorno parcial', agora: AGORA },
        'corr-4',
      );

      const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(invoice.status).toBe('PAID');
    });

    it('DOIS ESTORNOS SIMULTANEOS: um so passa -- guarda no BANCO, nao no if', async () => {
      /**
       * O teste que a F14 nao tinha, e que custou uma cobranca em dobro. Aqui
       * o erro seria DEVOLVER o dinheiro duas vezes.
       *
       * `Promise.allSettled` de verdade, contra Postgres de verdade: duas
       * requisicoes que leem o mesmo estado e escrevem juntas. Um
       * `if (jaExiste)` no codigo passaria nas duas.
       */
      const { paymentId } = await pagamentoConfirmado();

      const resultados = await Promise.allSettled([
        estornar.executar(
          contexto,
          { paymentId, amountMinor: 12_000, reason: 'corrida A', agora: AGORA },
          'corr-5a',
        ),
        estornar.executar(
          contexto,
          { paymentId, amountMinor: 12_000, reason: 'corrida B', agora: AGORA },
          'corr-5b',
        ),
      ]);

      const sucessos = resultados.filter((r) => r.status === 'fulfilled');
      expect(sucessos).toHaveLength(1);

      const gravados = await db.refund.count({
        where: { tenantId: contexto.tenantId, paymentId, status: 'CONFIRMED' },
      });
      expect(gravados).toBe(1);
    });

    it('pagamento manual nao e estornavel pelo sistema (ADR-027)', async () => {
      periodo += 1;
      const invoice = await db.invoice.create({
        data: {
          tenantId: contexto.tenantId,
          subscriptionId,
          studentId,
          billingPeriod: competenciaUnica(periodo),
          number: periodo,
          status: 'PAID',
          currency: 'BRL',
          subtotalMinor: 12_000,
          totalMinor: 12_000,
          dueAt: PAGO_EM,
          paidAt: PAGO_EM,
        },
        select: { id: true },
      });

      const manual = await db.payment.create({
        data: {
          tenantId: contexto.tenantId,
          invoiceId: invoice.id,
          amountMinor: 12_000,
          currency: 'BRL',
          method: 'MANUAL',
          status: 'CONFIRMED',
          paidAt: PAGO_EM,
          recognizedByUserId: contexto.actorId,
        },
        select: { id: true },
      });

      await expect(
        estornar.executar(
          contexto,
          { paymentId: manual.id, amountMinor: 12_000, reason: 'tentativa', agora: AGORA },
          'corr-6',
        ),
      ).rejects.toThrow(PagamentoManualNaoEstornavelError);
    });

    it('teto do tenant recusa o estorno acima do limite', async () => {
      await db.billingSettings.update({
        where: { tenantId: contexto.tenantId },
        data: { refundLimitMinor: 5_000 },
      });

      const { paymentId } = await pagamentoConfirmado();

      await expect(
        estornar.executar(
          contexto,
          { paymentId, amountMinor: 12_000, reason: 'acima do teto', agora: AGORA },
          'corr-7',
        ),
      ).rejects.toThrow(LimiteDeEstornoExcedidoError);

      await db.billingSettings.update({
        where: { tenantId: contexto.tenantId },
        data: { refundLimitMinor: null },
      });
    });

    it('estorno grava auditoria com ator e razao (INV-126)', async () => {
      const { paymentId } = await pagamentoConfirmado();

      const resultado = await estornar.executar(
        contexto,
        { paymentId, amountMinor: 12_000, reason: 'auditoria conferida', agora: AGORA },
        'corr-8',
      );

      const trilha = await db.auditLog.findFirstOrThrow({
        where: {
          tenantId: contexto.tenantId,
          action: 'billing.payment.refunded',
          targetId: paymentId,
        },
      });

      expect(trilha.actorId).toBe(contexto.actorId);
      expect(trilha.correlationId).toBe('corr-8');
      expect(JSON.stringify(trilha.metadata)).toContain('auditoria conferida');
      expect(resultado.refundId).toBeTruthy();
    });

    it('estorno publica PaymentRefunded no outbox, na mesma transacao', async () => {
      const { paymentId } = await pagamentoConfirmado();

      const resultado = await estornar.executar(
        contexto,
        { paymentId, amountMinor: 12_000, reason: 'evento de dominio', agora: AGORA },
        'corr-9',
      );

      const evento = await db.outboxEvent.findFirstOrThrow({
        where: {
          tenantId: contexto.tenantId,
          eventType: 'PaymentRefunded',
          aggregateId: paymentId,
        },
      });

      expect(JSON.stringify(evento.payload)).toContain(resultado.refundId);
    });
  });

  describe('conciliacao', () => {
    it('pagamento nos dois lados: MATCHED, zero divergencia', async () => {
      await pagamentoConfirmado(12_000, PAGO_EM_CONC);

      const resultado = await conciliar.executar(contexto, {
        providerAccountId,
        de: JANELA_CONC.de,
        ate: JANELA_CONC.ate,
        agora: AGORA,
      });

      expect(resultado.status).toBe('COMPLETED');
      expect(resultado.itensEmAberto).toBe(0);

      const itens = await db.reconciliationItem.findMany({
        where: { tenantId: contexto.tenantId, runId: resultado.runId },
      });
      expect(itens.every((i) => i.status === 'MATCHED')).toBe(true);
      // TODO movimento vira linha, inclusive o que bateu -- e o que permite
      // responder "conciliei 100%?".
      expect(itens.length).toBeGreaterThan(0);
    });

    it('REEXECUTAR A MESMA JANELA e idempotente, nao duplica divergencia', async () => {
      const primeira = await conciliar.executar(contexto, {
        providerAccountId,
        de: JANELA_CONC.de,
        ate: JANELA_CONC.ate,
        agora: AGORA,
      });

      const segunda = await conciliar.executar(contexto, {
        providerAccountId,
        de: JANELA_CONC.de,
        ate: JANELA_CONC.ate,
        agora: AGORA,
      });

      expect(segunda.runId).toBe(primeira.runId);
      expect(segunda.jaExistia).toBe(true);
    });

    it('janela em curso e RECUSADA -- conciliar o presente inventa divergencia', async () => {
      await expect(
        conciliar.executar(contexto, {
          providerAccountId,
          de: JANELA_CONC.de,
          ate: new Date(AGORA.getTime() + 60_000),
          agora: AGORA,
        }),
      ).rejects.toThrow();
    });

    it('dinheiro que o provedor nao reporta vira MISSING_EXTERNAL', async () => {
      // Terceira janela: reusar a de cima devolveria a run ja concluida pela
      // idempotencia, e o caso nunca chegaria a conciliar.
      const quando = new Date('2026-11-10T12:00:00.000Z');
      const { externalPaymentId } = await pagamentoConfirmado(9_900, quando);
      provedor.esquecerMovimentoDoExtrato(externalPaymentId);

      const resultado = await conciliar.executar(contexto, {
        providerAccountId,
        de: new Date('2026-11-01T00:00:00Z'),
        ate: new Date('2026-12-01T00:00:00Z'),
        agora: AGORA,
      });

      const item = await db.reconciliationItem.findFirstOrThrow({
        where: {
          tenantId: contexto.tenantId,
          runId: resultado.runId,
          status: 'MISSING_EXTERNAL',
          internalAmountMinor: 9_900,
        },
      });

      expect(item.externalMovementId).toBeNull();
      expect(item.recommendedAction.length).toBeGreaterThan(20);
      expect(resultado.itensEmAberto).toBeGreaterThan(0);
    });

    it('divergencia publica ReconciliationMismatchDetected', async () => {
      const evento = await db.outboxEvent.findFirst({
        where: { tenantId: contexto.tenantId, eventType: 'ReconciliationMismatchDetected' },
      });

      expect(evento).not.toBeNull();
    });
  });

  describe('resolucao de divergencia', () => {
    it('operador aceita a diferenca documentada SEM tocar no banco financeiro', async () => {
      const item = await db.reconciliationItem.findFirstOrThrow({
        where: { tenantId: contexto.tenantId, status: 'MISSING_EXTERNAL' },
        select: { id: true, paymentId: true },
      });

      const antes = item.paymentId
        ? await db.payment.findUniqueOrThrow({ where: { id: item.paymentId } })
        : null;

      const resolvido = await resolver.executar(
        contexto,
        {
          itemId: item.id,
          comando: 'ACCEPT_DOCUMENTED_DIFFERENCE',
          reason: 'liquidacao caiu no dia seguinte, conferido com o extrato',
          agora: AGORA,
        },
        'corr-10',
      );

      expect(resolvido.comando).toBe('ACCEPT_DOCUMENTED_DIFFERENCE');

      const depois = await db.reconciliationItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(depois.status).toBe('RESOLVED');
      expect(depois.resolvedByUserId).toBe(contexto.actorId);
      expect(depois.resolutionReason).toContain('liquidacao');

      /**
       * O ACEITE DA FATIA, verificado: "sem duplicar efeito financeiro". O
       * pagamento continua EXATAMENTE como estava -- aceitar a diferenca
       * registra uma decisao, nao move dinheiro.
       */
      if (antes && item.paymentId) {
        const pagamentoDepois = await db.payment.findUniqueOrThrow({
          where: { id: item.paymentId },
        });
        expect(pagamentoDepois.status).toBe(antes.status);
        expect(pagamentoDepois.amountMinor).toBe(antes.amountMinor);
      }
    });

    it('resolver duas vezes o mesmo item e recusado', async () => {
      const item = await db.reconciliationItem.findFirstOrThrow({
        where: { tenantId: contexto.tenantId, status: 'RESOLVED' },
        select: { id: true },
      });

      await expect(
        resolver.executar(
          contexto,
          {
            itemId: item.id,
            comando: 'ACCEPT_DOCUMENTED_DIFFERENCE',
            reason: 'segunda tentativa',
            agora: AGORA,
          },
          'corr-11',
        ),
      ).rejects.toThrow();
    });

    it('resolucao grava auditoria (M2-FR-020)', async () => {
      const trilha = await db.auditLog.findFirst({
        where: { tenantId: contexto.tenantId, action: 'billing.reconciliation.resolved' },
      });

      expect(trilha).not.toBeNull();
      expect(trilha?.actorId).toBe(contexto.actorId);
    });
  });

  describe('recibo', () => {
    it('emite recibo nao fiscal com codigo de verificacao', async () => {
      const { paymentId } = await pagamentoConfirmado();

      const emitido = await recibo.executar(contexto, { paymentId, agora: AGORA });

      expect(emitido.snapshot.tipo).toBe('RECIBO NÃO FISCAL');
      expect(emitido.verificationHash).toMatch(/^[0-9a-f]{64}$/);
      expect(emitido.numero).toBeGreaterThan(0);
      expect(emitido.snapshot.itens.length).toBeGreaterThan(0);
    });

    it('REEMITIR devolve o MESMO documento e o MESMO numero', async () => {
      const { paymentId } = await pagamentoConfirmado();

      const primeiro = await recibo.executar(contexto, { paymentId, agora: AGORA });
      const segundo = await recibo.executar(contexto, { paymentId, agora: AGORA });

      // Numero novo faria parecer que o aluno pagou duas vezes.
      expect(segundo.receiptId).toBe(primeiro.receiptId);
      expect(segundo.numero).toBe(primeiro.numero);
    });

    it('numeracao e sequencial por tenant, sem buraco', async () => {
      const a = await pagamentoConfirmado();
      const b = await pagamentoConfirmado();

      const primeiro = await recibo.executar(contexto, { paymentId: a.paymentId, agora: AGORA });
      const segundo = await recibo.executar(contexto, { paymentId: b.paymentId, agora: AGORA });

      expect(segundo.numero).toBe(primeiro.numero + 1);
    });

    it('recibo NAO expoe a referencia inteira do provedor', async () => {
      const { paymentId, externalPaymentId } = await pagamentoConfirmado();

      const emitido = await recibo.executar(contexto, { paymentId, agora: AGORA });

      expect(emitido.snapshot.pagamento.referenciaFinal).not.toBe(externalPaymentId);
      expect(emitido.snapshot.pagamento.referenciaFinal).toHaveLength(6);
    });

    it('pagamento nao confirmado nao gera recibo', async () => {
      periodo += 1;
      const invoice = await db.invoice.create({
        data: {
          tenantId: contexto.tenantId,
          subscriptionId,
          studentId,
          billingPeriod: competenciaUnica(periodo),
          number: periodo,
          status: 'OPEN',
          currency: 'BRL',
          subtotalMinor: 12_000,
          totalMinor: 12_000,
          dueAt: PAGO_EM,
        },
        select: { id: true },
      });

      const pendente = await db.payment.create({
        data: {
          tenantId: contexto.tenantId,
          invoiceId: invoice.id,
          amountMinor: 12_000,
          currency: 'BRL',
          method: 'PIX',
          status: 'PENDING',
        },
        select: { id: true },
      });

      await expect(
        recibo.executar(contexto, { paymentId: pendente.id, agora: AGORA }),
      ).rejects.toThrow();
    });
  });

  describe('isolamento de tenant', () => {
    it('estorno de pagamento de outro tenant nao e encontrado', async () => {
      const outro = await db.tenant.create({
        data: {
          slug: `f16-outro-${sufixo}`,
          legalName: `Outro ${sufixo}`,
          displayName: `Outro ${sufixo}`,
        },
        select: { id: true },
      });

      const { paymentId } = await pagamentoConfirmado();

      await expect(
        estornar.executar(
          { ...contexto, tenantId: outro.id },
          { paymentId, amountMinor: 12_000, reason: 'travessia de tenant', agora: AGORA },
          'corr-12',
        ),
      ).rejects.toThrow();

      await db.tenant.delete({ where: { id: outro.id } });
    });
  });
});
