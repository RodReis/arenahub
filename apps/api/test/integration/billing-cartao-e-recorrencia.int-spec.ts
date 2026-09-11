import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import {
  CobrancaEsgotadaError,
  CobrancaJaEmAndamentoError,
  CobrarAssinaturaNoCartaoUseCase,
} from '../../src/modules/billing/cobrar-assinatura-no-cartao.use-case.js';
import { CancelarRecorrenciaUseCase } from '../../src/modules/billing/cancelar-recorrencia.use-case.js';
import {
  TOKEN_RECUSADO_DEFINITIVO,
  TOKEN_RECUSADO_TEMPORARIO,
} from '../../src/modules/billing/provider/fake-payment-provider.adapter.js';
import { RegistrarMetodoDePagamentoUseCase } from '../../src/modules/billing/registrar-metodo-de-pagamento.use-case.js';
import { FakePaymentProvider } from '../../src/modules/billing/provider/fake-payment-provider.adapter.js';
import { PAYMENT_PROVIDER } from '../../src/modules/billing/provider/payment-provider.port.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F14 -- cartao e recorrencia (Slice 2.3).
 *
 * ACEITE DA SLICE, palavra por palavra: "ArenaHub nunca recebe PAN/CVV e
 * representa corretamente sucesso, falha e cancelamento".
 *
 * A primeira metade e provada ESTRUTURALMENTE em
 * `dado-de-cartao-nao-entra-no-backend.spec.ts` -- teste de comportamento so
 * pegaria depois que o dado ja estivesse trafegando. Este arquivo prova a
 * segunda: sucesso, falha (nos dois sabores) e cancelamento.
 *
 * Contra banco de verdade (`docs/TESTING.md` 3): a politica de retry conta
 * tentativas gravadas, e a unicidade do metodo padrao e um indice parcial do
 * Postgres. Dublar o banco provaria o `where` do TypeScript, nao a garantia.
 */
describe('F14 -- cartao, recorrencia e politica de retry', () => {
  let db: PrismaService;
  let registrarMetodo: RegistrarMetodoDePagamentoUseCase;
  let cobrar: CobrarAssinaturaNoCartaoUseCase;
  let cancelar: CancelarRecorrenciaUseCase;
  let fake: FakePaymentProvider;

  const sufixo = randomUUID().slice(0, 8);
  const contexto: TenantContext = {
    tenantId: '',
    actorId: randomUUID(),
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };

  let studentId = '';
  let subscriptionId = '';
  const VENCIMENTO = new Date('2026-09-10T12:00:00.000Z');

  /** Abre uma invoice nova, para que cada caso conte tentativas do zero. */
  async function novaInvoice(): Promise<string> {
    const invoice = await db.invoice.create({
      data: {
        tenantId: contexto.tenantId,
        subscriptionId,
        studentId,
        billingPeriod: new Date(`2026-${String(proximoPeriodo()).padStart(2, '0')}-01T00:00:00Z`),
        number: proximoPeriodo(),
        status: 'OPEN',
        currency: 'BRL',
        subtotalMinor: 12000,
        totalMinor: 12000,
        dueAt: VENCIMENTO,
      },
      select: { id: true },
    });

    return invoice.id;
  }

  let periodo = 0;
  function proximoPeriodo(): number {
    return (periodo % 12) + 1;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    registrarMetodo = comContextoDeTenant(moduleRef.get(RegistrarMetodoDePagamentoUseCase));
    cobrar = comContextoDeTenant(moduleRef.get(CobrarAssinaturaNoCartaoUseCase));
    cancelar = moduleRef.get(CancelarRecorrenciaUseCase);
    fake = moduleRef.get(PAYMENT_PROVIDER);

    const tenant = await db.tenant.create({
      data: {
        slug: `f14-${sufixo}`,
        legalName: `F14 ${sufixo} LTDA`,
        displayName: `F14 ${sufixo}`,
      },
    });
    contexto.tenantId = tenant.id;

    await db.providerAccount.create({
      data: {
        tenantId: tenant.id,
        provider: 'getnet',
        capability: 'CARD',
        externalAccountId: `ACC-CARD-${sufixo}`,
        signingSecretEncrypted: 'nao-sai-deste-arquivo',
      },
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

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        membershipNumber: `M-${sufixo}`,
        fullName: 'Aluno F14',
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    studentId = aluno.id;

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Plano F14 ${sufixo}` },
      select: { id: true },
    });

    const assinatura = await db.subscription.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        planId: plano.id,
        status: 'ACTIVE',
        startsAt: new Date('2026-09-01T00:00:00Z'),
      },
      select: { id: true },
    });
    subscriptionId = assinatura.id;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: contexto.tenantId } });
  });

  it('o PRIMEIRO metodo do aluno vira padrao sem ninguem pedir', async () => {
    /**
     * Sem isto, cadastrar cartao e nao marcar a caixinha deixaria a
     * assinatura sem forma de cobranca -- e a falha so apareceria no dia do
     * vencimento, longe da acao que a causou.
     */
    const metodo = await registrarMetodo.executar(contexto, {
      studentId,
      externalTokenId: `tok_bom_${sufixo}`,
      brand: 'visa',
      last4: '4242',
    });

    expect(metodo.isDefault).toBe(true);
    expect(metodo.provider).toBe('getnet');
    expect(metodo.last4).toBe('4242');
  });

  it('reenviar o MESMO token nao duplica o metodo', async () => {
    /**
     * O checkout hospedado devolve o mesmo token para o mesmo cartao, e uma
     * tela recarregada repete a chamada. Sem esta regra o aluno acumularia
     * metodos a cada tentativa interrompida.
     */
    const primeiro = await registrarMetodo.executar(contexto, {
      studentId,
      externalTokenId: `tok_bom_${sufixo}`,
      brand: 'visa',
      last4: '4242',
    });

    const quantos = await db.paymentMethod.count({
      where: { tenantId: contexto.tenantId, studentId },
    });

    expect(quantos).toBe(1);
    expect(primeiro.isDefault).toBe(true);
  });

  it('cobranca no cartao cria tentativa PROCESSING, e NAO confirma a invoice', async () => {
    /**
     * Confirmar aqui criaria um SEGUNDO caminho de escrita para "invoice
     * paga" -- exatamente o que a INV-076 existe para impedir. Quem confirma
     * e o webhook, uma vez, com a constraint atras.
     */
    const invoiceId = await novaInvoice();

    const cobranca = await cobrar.executar(contexto, { invoiceId, agora: VENCIMENTO });

    /**
     * `fake_card_`, NAO `fake_sub_` (ADR-043, Decisao 5).
     *
     * O prefixo e a assercao inteira: ate 25/08/2026 este teste esperava
     * `fake_sub_` e passava, porque a cobranca de invoice chamava
     * `createTokenizedSubscription`. Contra a Getnet real aquilo instalaria
     * uma recorrencia mensal viva POR INVOICE. Um `toBeDefined()` aqui teria
     * sobrevivido aos dois mundos -- e foi por nao olhar o prefixo que o
     * defeito atravessou a F14 inteira.
     */
    expect(cobranca.externalPaymentId).toMatch(/^fake_card_/);
    expect(cobranca.externalPaymentId).not.toMatch(/^fake_sub_/);

    const tentativa = await db.paymentAttempt.findUnique({
      where: { id: cobranca.paymentAttemptId },
      select: { status: true, method: true, externalPaymentId: true, providerAccountId: true },
    });
    expect(tentativa?.status).toBe('PROCESSING');
    expect(tentativa?.method).toBe('CARD');

    /**
     * O ID EXTERNO, nao o UUID interno da conta (FIX #164).
     *
     * Ate a correcao, esta escrita gravava `conta.id` -- e passava, porque
     * NENHUM teste olhava a coluna. A assercao e pelo valor exato de
     * proposito: `toBeDefined()` passaria com o UUID errado, que foi
     * justamente como o defeito sobreviveu a F14 inteira.
     */
    const conta = await db.providerAccount.findFirstOrThrow({
      where: { tenantId: contexto.tenantId, capability: 'CARD' },
      select: { id: true, externalAccountId: true },
    });
    expect(tentativa?.providerAccountId).toBe(conta.externalAccountId);
    expect(tentativa?.providerAccountId).not.toBe(conta.id);

    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true },
    });
    expect(invoice?.status).toBe('OPEN');
  });

  it('recusa TEMPORARIA grava a falha e permite nova tentativa', async () => {
    periodo += 1;
    const invoiceId = await novaInvoice();

    await db.paymentMethod.updateMany({
      where: { tenantId: contexto.tenantId, studentId },
      data: { externalTokenId: `${TOKEN_RECUSADO_TEMPORARIO}_${sufixo}` },
    });

    await expect(cobrar.executar(contexto, { invoiceId, agora: VENCIMENTO })).rejects.toThrow();

    const tentativa = await db.paymentAttempt.findFirst({
      where: { tenantId: contexto.tenantId, invoiceId, method: 'CARD' },
      select: { status: true, failureIsPermanent: true, failureCode: true },
    });

    expect(tentativa?.status).toBe('FAILED');
    expect(tentativa?.failureIsPermanent).toBe(false);
    expect(tentativa?.failureCode).toBe('PROVIDER_REJECTED');

    /**
     * A SEGUNDA tentativa acontece -- saldo insuficiente hoje pode virar
     * saldo suficiente em tres dias. E a diferenca que a politica do PI faz.
     */
    await db.paymentMethod.updateMany({
      where: { tenantId: contexto.tenantId, studentId },
      data: { externalTokenId: `tok_bom_2_${sufixo}` },
    });

    const segunda = await cobrar.executar(contexto, { invoiceId, agora: VENCIMENTO });
    expect(segunda.externalPaymentId).toMatch(/^fake_card_/);
  });

  it('recusa PERMANENTE para na hora, com tentativas ainda sobrando', async () => {
    /**
     * A decisao do PI em 19/08/2026: cartao cancelado devolve o mesmo
     * resultado na segunda tentativa e na terceira -- repetir so gera taxa e
     * conta como recusa contra a loja na adquirente.
     */
    periodo += 1;
    const invoiceId = await novaInvoice();

    await db.paymentMethod.updateMany({
      where: { tenantId: contexto.tenantId, studentId },
      data: { externalTokenId: `${TOKEN_RECUSADO_DEFINITIVO}_${sufixo}` },
    });

    await expect(cobrar.executar(contexto, { invoiceId, agora: VENCIMENTO })).rejects.toThrow();

    const tentativa = await db.paymentAttempt.findFirst({
      where: { tenantId: contexto.tenantId, invoiceId, method: 'CARD' },
      select: { failureIsPermanent: true },
    });
    expect(tentativa?.failureIsPermanent).toBe(true);

    /**
     * So UMA tentativa foi feita das tres disponiveis -- e a proxima chamada
     * ja recusa sem tocar no provedor.
     */
    await expect(
      cobrar.executar(contexto, { invoiceId, agora: VENCIMENTO }),
    ).rejects.toBeInstanceOf(CobrancaEsgotadaError);

    const quantasTentativas = await db.paymentAttempt.count({
      where: { tenantId: contexto.tenantId, invoiceId, method: 'CARD' },
    });
    expect(quantasTentativas).toBe(1);
  });

  it('esgotadas as tres tentativas, para de cobrar', async () => {
    periodo += 1;
    const invoiceId = await novaInvoice();

    await db.paymentMethod.updateMany({
      where: { tenantId: contexto.tenantId, studentId },
      data: { externalTokenId: `${TOKEN_RECUSADO_TEMPORARIO}_b_${sufixo}` },
    });

    for (let i = 0; i < 3; i += 1) {
      await expect(cobrar.executar(contexto, { invoiceId, agora: VENCIMENTO })).rejects.toThrow();
    }

    await expect(
      cobrar.executar(contexto, { invoiceId, agora: VENCIMENTO }),
    ).rejects.toBeInstanceOf(CobrancaEsgotadaError);

    const quantas = await db.paymentAttempt.count({
      where: { tenantId: contexto.tenantId, invoiceId, method: 'CARD' },
    });
    expect(quantas).toBe(3);
  });

  it('duas cobrancas CONCORRENTES nao cobram o aluno duas vezes', async () => {
    /**
     * DEFEITO REAL, achado sondando a fatia antes do PR -- e nao previsto por
     * nenhum caso escrito ate aqui.
     *
     * A chave de idempotencia e `card:<invoice>:<tentativas ja feitas>`,
     * derivada de uma CONTAGEM. Contagem muda entre a leitura e a escrita:
     * duas requisicoes concorrentes leem 0 e 1, montam `:0` e `:1`, e a
     * constraint `(tenant_id, idempotency_key)` NUNCA dispara. Medido: 2
     * sucessos, 2 tentativas gravadas, aluno cobrado em dobro.
     *
     * Quem fecha a janela e o indice parcial
     * `payment_attempts_uma_cobranca_de_cartao_em_voo` -- no BANCO, porque um
     * `if (jaExiste)` no codigo perde a mesma corrida. Mesma tese do inbox de
     * webhook da F13 (INV-076).
     */
    periodo += 1;
    const invoiceId = await novaInvoice();

    await db.paymentMethod.updateMany({
      where: { tenantId: contexto.tenantId, studentId },
      data: { externalTokenId: `tok_concorrente_${sufixo}` },
    });

    const resultados = await Promise.allSettled([
      cobrar.executar(contexto, { invoiceId, agora: VENCIMENTO }),
      cobrar.executar(contexto, { invoiceId, agora: VENCIMENTO }),
    ]);

    const sucessos = resultados.filter((r) => r.status === 'fulfilled');
    expect(sucessos).toHaveLength(1);

    const gravadas = await db.paymentAttempt.count({
      where: { tenantId: contexto.tenantId, invoiceId, method: 'CARD' },
    });
    expect(gravadas).toBe(1);

    /**
     * A perdedora recebe 409 de dominio, nao 500 do Prisma: erro de servidor
     * faria a recepcao clicar de novo, que e o oposto do que se quer.
     */
    const perdedora = resultados.find((r) => r.status === 'rejected');
    expect(perdedora).toBeDefined();
    if (perdedora?.status === 'rejected') {
      expect(perdedora.reason).toBeInstanceOf(CobrancaJaEmAndamentoError);
    }
  });

  it('cobrar tres invoices NAO instala nenhuma recorrencia no provedor', async () => {
    /**
     * ADR-043, Decisao 5 -- o teste que fecha a porta.
     *
     * O bug que ele guarda: ate 25/08/2026 a cobranca de invoice chamava
     * `createTokenizedSubscription`, e contra a Getnet real cada mensalidade
     * instalaria um CALENDARIO. No segundo mes o aluno seria cobrado pela
     * recorrencia de setembro E pela de outubro; no decimo segundo, doze
     * vezes. A suite inteira passava, porque o duble devolve um id de
     * qualquer jeito e ninguem olhava o que ficava instalado.
     *
     * A assercao e sobre o ESTADO NO PROVEDOR, nao sobre o retorno: o id
     * devolvido diz o que voltou daquela chamada, e o que cobra o aluno no
     * mes seguinte e o que ficou de pe. Sao perguntas diferentes, e so a
     * segunda pega este defeito.
     */
    const antes = fake.recorrenciasInstaladas;

    for (let i = 0; i < 3; i += 1) {
      /**
       * `periodo += 1` ANTES de abrir a invoice: o periodo entra na chave
       * `(tenant_id, subscription_id, billing_period)`, e tres invoices no
       * mesmo periodo colidem na constraint. Os outros casos abrem uma so, e
       * por isso incrementam depois.
       */
      periodo += 1;
      await cobrar.executar(contexto, { invoiceId: await novaInvoice(), agora: VENCIMENTO });
    }

    expect(fake.recorrenciasInstaladas).toBe(antes);
  });

  it('cancelar a recorrencia NAO cancela a assinatura', async () => {
    /**
     * Sao coisas diferentes, e confundi-las tira o acesso de quem pagou: o
     * aluno que cancela hoje um plano pago ate o dia 30 continua entrando
     * ate o dia 30. Quem decide acesso e o entitlement (regra no 1).
     */
    const resultado = await cancelar.executar(contexto, { subscriptionId });

    /**
     * ZERO, e nao "mais que zero" (ADR-043, Decisao 5).
     *
     * Este numero era maior que zero por causa de um BUG: a cobranca de
     * invoice instalava uma recorrencia por invoice, e o cancelamento
     * encontrava aquele lixo para cancelar. Cobrar invoice nao instala
     * calendario -- entao nao ha o que cancelar, e o proprio caso de uso
     * declara que zero nao e erro.
     *
     * Recorrencia de verdade nasce na F56, e e la que este numero volta a
     * ser maior que zero, lendo `Subscription.externalSubscriptionId`.
     */
    expect(resultado.canceladasNoProvedor).toBe(0);

    const assinatura = await db.subscription.findUnique({
      where: { id: subscriptionId },
      select: { status: true },
    });
    expect(assinatura?.status).toBe('ACTIVE');
  });

  it('cancelar duas vezes nao falha: o estado desejado ja vale', async () => {
    /**
     * O aluno pode ter cancelado pelo app do banco, ou o provedor pode ter
     * encerrado por conta propria. Devolver erro faria a recepcao tentar de
     * novo para sempre.
     */
    const segunda = await cancelar.executar(contexto, { subscriptionId });

    expect(segunda.canceladasNoProvedor).toBe(0);
  });
});
