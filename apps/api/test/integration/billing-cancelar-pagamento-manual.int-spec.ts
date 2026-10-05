import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { BillingRepository } from '../../src/modules/billing/billing.repository.js';
import {
  CancelamentoInvalidoError,
  CreditoJaAplicadoError,
  PagamentoCanceladoError,
  PagamentoNaoCancelavelError,
} from '../../src/modules/billing/domain/cancelamento-de-pagamento.js';
import {
  CancelarPagamentoManualUseCase,
  PagamentoNaoEncontradoParaCancelamentoError,
} from '../../src/modules/billing/cancelar-pagamento-manual.use-case.js';
import { TransicaoDeInvoiceConcorrenteError } from '../../src/modules/billing/domain/invoice.js';
import { EmitirReciboUseCase } from '../../src/modules/billing/emitir-recibo.use-case.js';
import { RegistrarPagamentoEmLoteUseCase } from '../../src/modules/billing/registrar-pagamento-em-lote.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Cancelamento de pagamento manual lancado por engano (F85, decisao do PI em
 * 05/10/2026). Contra banco de verdade: a atomicidade, a corrida de dois
 * cancelamentos e a restauracao do vencimento sao comportamento do Postgres.
 *
 * O pagamento e criado pelo CAMINHO REAL (lote da recepcao), nao por `INSERT`:
 * e ele que ancora o vencimento da fatura seguinte, e e esse efeito que o
 * cancelamento precisa desfazer.
 */
describe('CancelarPagamentoManualUseCase', () => {
  let db: PrismaService;
  let cancelar: CancelarPagamentoManualUseCase;
  let registrarLote: RegistrarPagamentoEmLoteUseCase;
  let recibo: EmitirReciboUseCase;
  let billing: BillingRepository;

  const sufixo = randomUUID().slice(0, 8);
  const AGORA = new Date('2026-10-05T19:13:00Z');
  const contexto: TenantContext = {
    tenantId: '',
    actorId: '',
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };
  let outroTenantId = '';
  let unidadeId = '';
  let planoId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    cancelar = comContextoDeTenant(moduleRef.get(CancelarPagamentoManualUseCase));
    registrarLote = comContextoDeTenant(moduleRef.get(RegistrarPagamentoEmLoteUseCase));
    recibo = comContextoDeTenant(moduleRef.get(EmitirReciboUseCase));
    billing = comContextoDeTenant(moduleRef.get(BillingRepository));

    const tenant = await db.tenant.create({
      data: { slug: `canc-${sufixo}`, legalName: `Canc ${sufixo} LTDA`, displayName: `Canc ${sufixo}` },
    });
    contexto.tenantId = tenant.id;

    const outro = await db.tenant.create({
      data: { slug: `canc2-${sufixo}`, legalName: `Canc2 ${sufixo} LTDA`, displayName: `Canc2 ${sufixo}` },
    });
    outroTenantId = outro.id;

    const senhas = moduleRef.get(PasswordService);
    const operador = await db.user.create({
      data: {
        email: `canc-op-${sufixo}@exemplo.test`,
        passwordHash: await senhas.gerarHash('canc-senha-de-teste-nao-usada-em-producao'),
      },
      select: { id: true },
    });
    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: operador.id } });
    contexto.actorId = operador.id;

    await db.billingSettings.create({ data: { tenantId: tenant.id, dueDay: 9, graceDays: 3 } });

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
        name: `Plano Canc ${sufixo}`,
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
    await db.tenant.deleteMany({ where: { id: { in: [contexto.tenantId, outroTenantId] } } });
  });

  async function novaAssinatura(): Promise<{ studentId: string; subscriptionId: string }> {
    const marca = randomUUID().slice(0, 8);
    const aluno = await db.student.create({
      data: {
        tenantId: contexto.tenantId,
        gymUnitId: unidadeId,
        membershipNumber: `CANC-${marca}`,
        fullName: 'Aluno Cancelamento',
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
        startsAt: new Date('2026-01-01T00:00:00Z'),
      },
      select: { id: true },
    });

    return { studentId: aluno.id, subscriptionId: assinatura.id };
  }

  /** Paga um lote de meses ('YYYY-MM') pelo caminho real da recepcao. */
  async function pagarLote(
    subscriptionId: string,
    competencias: string[],
    receivedAmountMinor?: number,
  ): Promise<void> {
    await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        competencias: competencias.map((c) => new Date(`${c}-01T00:00:00Z`)),
        dispensar: [],
        paidAt: new Date('2026-10-05T00:00:00Z'),
        channel: 'DINHEIRO',
        expectedTotalMinor: 10000 * competencias.length,
        ...(receivedAmountMinor !== undefined ? { receivedAmountMinor } : {}),
        idempotencyKey: randomUUID(),
        agora: AGORA,
      },
      'corr-cancelamento',
    );
  }

  async function invoiceDe(subscriptionId: string, mes: string) {
    return db.invoice.findUniqueOrThrow({
      where: {
        tenantId_subscriptionId_billingPeriod: {
          tenantId: contexto.tenantId,
          subscriptionId,
          billingPeriod: new Date(`${mes}-01T00:00:00Z`),
        },
      },
    });
  }

  async function pagamentoDe(subscriptionId: string, mes: string) {
    const invoice = await invoiceDe(subscriptionId, mes);

    return db.payment.findFirstOrThrow({ where: { invoiceId: invoice.id, status: 'CONFIRMED' } });
  }

  const cancelarPagamento = (paymentId: string, reason = 'lancado no aluno errado') =>
    cancelar.executar(contexto, { paymentId, reason, agora: AGORA }, 'corr-cancelamento');

  it('cancela o pagamento, reabre a fatura e devolve o vencimento da seguinte', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');

    // Pre-condicao: o lote ancorou nov em 05/10 + 30 dias.
    expect((await invoiceDe(subscriptionId, '2026-11')).dueAt.toISOString()).toBe('2026-11-04T00:00:00.000Z');

    const resultado = await cancelarPagamento(pagamento.id);

    expect(resultado).toEqual({
      paymentId: pagamento.id,
      invoiceId: pagamento.invoiceId,
      vencimentoRestaurado: true,
    });

    const depois = await db.payment.findUniqueOrThrow({ where: { id: pagamento.id } });
    expect(depois.status).toBe('CANCELLED');
    expect(depois.cancelReason).toBe('lancado no aluno errado');
    expect(depois.cancelledByUserId).toBe(contexto.actorId);
    expect(depois.cancelledAt?.toISOString()).toBe(AGORA.toISOString());
    // A trilha de quem lancou NAO some.
    expect(depois.recognizedByUserId).toBe(contexto.actorId);
    expect(depois.paidAt).not.toBeNull();

    const reaberta = await invoiceDe(subscriptionId, '2026-10');
    expect(reaberta.status).toBe('OPEN');
    expect(reaberta.paidAt).toBeNull();

    // Nov volta ao padrao do ciclo: dia 9, bloqueio +3 dias de carencia.
    const seguinte = await invoiceDe(subscriptionId, '2026-11');
    expect(seguinte.dueAt.toISOString()).toBe('2026-11-09T00:00:00.000Z');
    expect(seguinte.blockAt?.toISOString()).toBe('2026-11-12T00:00:00.000Z');

    const auditoria = await db.auditLog.findFirst({
      where: { tenantId: contexto.tenantId, action: 'billing.payment.cancelled', targetId: pagamento.id },
    });
    expect(auditoria).not.toBeNull();
    expect(auditoria?.actorId).toBe(contexto.actorId);

    const evento = await db.outboxEvent.findFirst({
      where: { tenantId: contexto.tenantId, eventType: 'PaymentCancelled', aggregateId: pagamento.id },
    });
    expect(evento).not.toBeNull();
  });

  it('nao toca em entitlement nem em assinatura (regra 1: acesso segue o entitlement)', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');

    await cancelarPagamento(pagamento.id);

    const assinatura = await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(assinatura.status).toBe('ACTIVE');
  });

  it('nao sobrescreve o vencimento da seguinte quando ele foi alterado por outra via', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    const seguinte = await invoiceDe(subscriptionId, '2026-11');
    await db.invoice.update({
      where: { id: seguinte.id },
      data: { dueAt: new Date('2026-11-20T00:00:00Z') },
    });

    const resultado = await cancelarPagamento(pagamento.id);

    expect(resultado.vencimentoRestaurado).toBe(false);
    expect((await invoiceDe(subscriptionId, '2026-11')).dueAt.toISOString()).toBe('2026-11-20T00:00:00.000Z');
  });

  it('lote de dois meses: cancelar um nao toca nos irmaos e so devolve o vencimento quando o lote inteiro foi desfeito', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10', '2026-11']);
    const pagamentoOut = await pagamentoDe(subscriptionId, '2026-10');
    const pagamentoNov = await pagamentoDe(subscriptionId, '2026-11');

    // Pre-condicao: dez ancorado em 05/10 + 60 dias.
    expect((await invoiceDe(subscriptionId, '2026-12')).dueAt.toISOString()).toBe('2026-12-04T00:00:00.000Z');

    const primeiro = await cancelarPagamento(pagamentoNov.id);

    expect(primeiro.vencimentoRestaurado).toBe(false);
    expect((await invoiceDe(subscriptionId, '2026-10')).status).toBe('PAID');
    expect((await invoiceDe(subscriptionId, '2026-11')).status).toBe('OPEN');
    expect((await invoiceDe(subscriptionId, '2026-12')).dueAt.toISOString()).toBe('2026-12-04T00:00:00.000Z');

    const segundo = await cancelarPagamento(pagamentoOut.id);

    expect(segundo.vencimentoRestaurado).toBe(true);
    expect((await invoiceDe(subscriptionId, '2026-12')).dueAt.toISOString()).toBe('2026-12-09T00:00:00.000Z');
  });

  it('expira o credito de sobrepagamento ainda disponivel', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10'], 12000);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    const antes = await db.accountCredit.findFirstOrThrow({ where: { originPaymentId: pagamento.id } });
    expect(antes.status).toBe('AVAILABLE');
    expect(antes.amountMinor).toBe(2000);

    await cancelarPagamento(pagamento.id);

    const depois = await db.accountCredit.findUniqueOrThrow({ where: { id: antes.id } });
    expect(depois.status).toBe('EXPIRED');
  });

  it('recusa quando o credito ja abateu outra fatura e deixa TUDO como estava', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10'], 12000);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    await db.accountCredit.updateMany({
      where: { originPaymentId: pagamento.id },
      data: { status: 'APPLIED' },
    });

    await expect(cancelarPagamento(pagamento.id)).rejects.toBeInstanceOf(CreditoJaAplicadoError);

    expect((await db.payment.findUniqueOrThrow({ where: { id: pagamento.id } })).status).toBe('CONFIRMED');
    expect((await invoiceDe(subscriptionId, '2026-10')).status).toBe('PAID');
  });

  it('recusa e desfaz tudo quando a fatura deixou de estar PAID (nao a ressuscita)', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    // Estado que o fluxo normal nao produz, mas que a barreira condicionada
    // existe para recusar: fatura ja resolvida por outra via.
    await db.invoice.update({ where: { id: pagamento.invoiceId }, data: { status: 'CANCELLED' } });

    await expect(cancelarPagamento(pagamento.id)).rejects.toBeInstanceOf(TransicaoDeInvoiceConcorrenteError);

    // A transacao inteira desfez: o pagamento NAO ficou cancelado.
    expect((await db.payment.findUniqueOrThrow({ where: { id: pagamento.id } })).status).toBe('CONFIRMED');
    expect((await invoiceDe(subscriptionId, '2026-10')).status).toBe('CANCELLED');
  });

  it('recusa PIX: o caminho dele e o estorno', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const invoice = await invoiceDe(subscriptionId, '2026-10');
    const pix = await db.payment.create({
      data: {
        tenantId: contexto.tenantId,
        invoiceId: invoice.id,
        amountMinor: 10000,
        method: 'PIX',
        status: 'CONFIRMED',
        paidAt: AGORA,
      },
    });

    await expect(cancelarPagamento(pix.id)).rejects.toBeInstanceOf(PagamentoNaoCancelavelError);
  });

  it('recusa o segundo cancelamento do mesmo pagamento', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    await cancelarPagamento(pagamento.id);

    await expect(cancelarPagamento(pagamento.id)).rejects.toBeInstanceOf(PagamentoNaoCancelavelError);
  });

  it('recusa motivo curto sem mudar nada', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');

    await expect(cancelarPagamento(pagamento.id, 'ab')).rejects.toBeInstanceOf(CancelamentoInvalidoError);

    expect((await db.payment.findUniqueOrThrow({ where: { id: pagamento.id } })).status).toBe('CONFIRMED');
    expect((await invoiceDe(subscriptionId, '2026-10')).status).toBe('PAID');
  });

  it('pagamento de outro tenant ou inexistente: 404', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');

    await expect(
      cancelar.executar(
        { ...contexto, tenantId: outroTenantId },
        { paymentId: pagamento.id, reason: 'tentativa cruzada', agora: AGORA },
        'corr',
      ),
    ).rejects.toBeInstanceOf(PagamentoNaoEncontradoParaCancelamentoError);

    await expect(cancelarPagamento(randomUUID())).rejects.toBeInstanceOf(
      PagamentoNaoEncontradoParaCancelamentoError,
    );
  });

  it('corrida: dois cancelamentos simultaneos -- exatamente um vence, o outro e recusado', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');

    const resultados = await Promise.allSettled([
      cancelarPagamento(pagamento.id, 'clique um'),
      cancelarPagamento(pagamento.id, 'clique dois'),
    ]);

    const vencedores = resultados.filter((r) => r.status === 'fulfilled');
    const perdedores = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    // O INVARIANTE, nao a classe do erro: o perdedor pode cair na checagem
    // inicial ou na barreira condicionada, e as duas sao respostas validas.
    expect(vencedores).toHaveLength(1);
    expect(perdedores).toHaveLength(1);
    expect((perdedores[0]!.reason as { code?: string }).code).toBe('BILLING_PAYMENT_NOT_CANCELLABLE');
    expect((await invoiceDe(subscriptionId, '2026-10')).status).toBe('OPEN');
  });

  it('o mes reaberto pode ser pago de novo pelo mesmo caminho do lote', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    await cancelarPagamento(pagamento.id);

    await pagarLote(subscriptionId, ['2026-10']);

    expect((await invoiceDe(subscriptionId, '2026-10')).status).toBe('PAID');
    const pagamentos = await db.payment.findMany({
      where: { invoiceId: pagamento.invoiceId },
      orderBy: { createdAt: 'asc' },
    });
    expect(pagamentos.map((p) => p.status)).toEqual(['CANCELLED', 'CONFIRMED']);
  });

  it('a grade do aluno nao lista o pagamento cancelado', async () => {
    const { studentId, subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    await cancelarPagamento(pagamento.id);

    const { invoices } = await billing.listarInvoicesDoAluno(contexto, studentId);
    const outubro = invoices.find((i) => i.id === pagamento.invoiceId);

    expect(outubro?.status).toBe('OPEN');
    expect(outubro?.payments).toHaveLength(0);
  });

  it('recibo ja emitido do pagamento cancelado nao e reemitido nem consultado', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    const emitido = await recibo.executar(contexto, { paymentId: pagamento.id, agora: AGORA });

    await cancelarPagamento(pagamento.id);

    await expect(recibo.executar(contexto, { paymentId: pagamento.id, agora: AGORA })).rejects.toBeInstanceOf(
      PagamentoCanceladoError,
    );
    await expect(recibo.consultar(contexto, emitido.receiptId)).rejects.toBeInstanceOf(PagamentoCanceladoError);
  });
});
