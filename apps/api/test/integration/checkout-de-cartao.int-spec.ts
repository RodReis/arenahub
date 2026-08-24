import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import {
  CheckoutJaEmAndamentoError,
  CriarCheckoutDeCartaoUseCase,
} from '../../src/modules/billing/criar-checkout-de-cartao.use-case.js';
import { FakePaymentProvider } from '../../src/modules/billing/provider/fake-payment-provider.adapter.js';
import { PAYMENT_PROVIDER } from '../../src/modules/billing/provider/payment-provider.port.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F53 -- task 3: mede se o indice parcial da F14 cobre o checkout hospedado.
 *
 * O indice `payment_attempts_uma_cobranca_de_cartao_em_voo`
 * (`20260819120000_f14_uma_cobranca_em_voo`) so enxerga tentativas com
 * `status = 'PROCESSING'`. O checkout hospedado grava a tentativa em
 * `CREATED` -- o default do schema, porque o aluno ainda nem abriu o link.
 *
 * Contra banco de verdade (`docs/TESTING.md` 3): a garantia e um indice
 * parcial do Postgres, dublar o banco provaria o `where` do TypeScript, nao a
 * garantia.
 */
describe('F53 -- checkout de cartao: indice parcial cobre CREATED?', () => {
  let db: PrismaService;

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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `f53-checkout-${sufixo}`,
        legalName: `F53 Checkout ${sufixo} LTDA`,
        displayName: `F53 Checkout ${sufixo}`,
      },
    });
    contexto.tenantId = tenant.id;

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
        fullName: 'Aluno F53',
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    studentId = aluno.id;

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Plano F53 ${sufixo}` },
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

  /** Abre uma invoice nova, para a sonda contar tentativas do zero. */
  async function criarInvoiceAberta(): Promise<{ id: string }> {
    const invoice = await db.invoice.create({
      data: {
        tenantId: contexto.tenantId,
        subscriptionId,
        studentId,
        billingPeriod: new Date('2026-09-01T00:00:00Z'),
        number: 1,
        status: 'OPEN',
        currency: 'BRL',
        subtotalMinor: 12000,
        totalMinor: 12000,
        dueAt: new Date('2026-09-10T12:00:00.000Z'),
      },
      select: { id: true },
    });

    return invoice;
  }

  /*
   * SONDA, nao teste de feature: responde se o indice parcial da F14 cobre uma
   * tentativa de cartao criada em `CREATED`.
   *
   * Ela grava DUAS tentativas de cartao para a MESMA invoice, concorrentes, e
   * conta quantas sobreviveram. Se as duas passarem, o indice nao cobre este
   * caminho e a Task 4 leva migration.
   */
  it('SONDA: duas tentativas de cartao em CREATED para a mesma invoice', async () => {
    const invoice = await criarInvoiceAberta();

    const gravar = (chave: string) =>
      db.paymentAttempt.create({
        data: {
          tenantId: contexto.tenantId,
          invoiceId: invoice.id,
          method: 'CARD',
          status: 'CREATED',
          idempotencyKey: chave,
        },
      });

    const resultados = await Promise.allSettled([
      gravar(`checkout:a:${sufixo}`),
      gravar(`checkout:b:${sufixo}`),
    ]);
    const sucessos = resultados.filter((r) => r.status === 'fulfilled').length;

    const gravadas = await db.paymentAttempt.count({
      where: { tenantId: contexto.tenantId, invoiceId: invoice.id, method: 'CARD' },
    });

    // eslint-disable-next-line no-console
    console.log(`SONDA — sucessos: ${sucessos}, gravadas: ${gravadas}`);
    expect({ sucessos, gravadas }).toEqual({ sucessos: 1, gravadas: 1 });
  });
});

/**
 * F53 -- task 4: caso de uso `CriarCheckoutDeCartaoUseCase`.
 *
 * Contra banco de verdade, mesma razao da sonda acima (`docs/TESTING.md` 3):
 * o teste de concorrencia mede o indice parcial pelo caminho inteiro do caso
 * de uso, e o teste de isolamento de tenant so prova algo se o segundo
 * tenant existir de verdade.
 */
describe('CriarCheckoutDeCartaoUseCase', () => {
  let db: PrismaService;
  let fake: FakePaymentProvider;
  let useCase: CriarCheckoutDeCartaoUseCase;

  const AGORA = new Date('2026-08-23T12:00:00.000Z');
  const sufixo = randomUUID().slice(0, 8);

  const contexto: TenantContext = {
    tenantId: '',
    actorId: '',
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };
  const outroContexto: TenantContext = {
    tenantId: '',
    actorId: '',
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };

  let planoId = '';
  let unidadeId = '';
  let outroSubscriptionId = '';
  let numeroDaInvoice = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    fake = moduleRef.get(PAYMENT_PROVIDER);
    useCase = moduleRef.get(CriarCheckoutDeCartaoUseCase);

    /*
     * `AuditLog.actorId` tem FK para `User`: o caso de uso grava audit log
     * no sucesso, e um ator inventado (`randomUUID()` sem linha correspondente)
     * quebra a escrita com violacao de chave estrangeira.
     */
    /*
     * `@arena.test`, NAO `@exemplo.test`: a guarda de vazamento
     * (`vazamento.int-spec.ts`) varre os usuarios de `@exemplo.test` exigindo
     * que todo `passwordHash` tenha a forma `scrypt$v=1$...`. Uma fixture com
     * hash sintetico naquele dominio derruba a guarda -- e a guarda esta
     * certa: e literalmente o trabalho dela achar senha que nao parece hash.
     *
     * O dominio alternativo e o mesmo que `billing.int-spec.ts` ja usa.
     */
    const usuario = await db.user.create({
      data: {
        email: `f53-uc-${sufixo}@arena.test`,
        passwordHash: 'x'.repeat(60),
      },
      select: { id: true },
    });
    contexto.actorId = usuario.id;
    outroContexto.actorId = usuario.id;

    const tenant = await db.tenant.create({
      data: {
        slug: `f53-uc-${sufixo}`,
        legalName: `F53 UC ${sufixo} LTDA`,
        displayName: `F53 UC ${sufixo}`,
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
    unidadeId = unidade.id;

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Plano F53 UC ${sufixo}` },
      select: { id: true },
    });
    planoId = plano.id;

    // Segundo tenant, so para o teste de isolamento (404, nunca 409).
    const outroTenant = await db.tenant.create({
      data: {
        slug: `f53-uc-outro-${sufixo}`,
        legalName: `F53 UC Outro ${sufixo} LTDA`,
        displayName: `F53 UC Outro ${sufixo}`,
      },
    });
    outroContexto.tenantId = outroTenant.id;

    await db.providerAccount.create({
      data: {
        tenantId: outroTenant.id,
        provider: 'getnet',
        capability: 'CARD',
        externalAccountId: `ACC-CARD-OUTRO-${sufixo}`,
        signingSecretEncrypted: 'nao-sai-deste-arquivo',
      },
    });

    const outraUnidade = await db.gymUnit.create({
      data: {
        tenantId: outroTenant.id,
        code: 'MTZ',
        name: 'Matriz',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const outroPlano = await db.plan.create({
      data: { tenantId: outroTenant.id, name: `Plano Outro ${sufixo}` },
      select: { id: true },
    });

    const outroAluno = await criarAluno(outroTenant.id, outraUnidade.id, `outro-${sufixo}`, {
      comCpf: true,
      comEndereco: true,
    });

    const outraAssinatura = await db.subscription.create({
      data: {
        tenantId: outroTenant.id,
        studentId: outroAluno.id,
        planId: outroPlano.id,
        status: 'ACTIVE',
        startsAt: new Date('2026-09-01T00:00:00Z'),
      },
      select: { id: true },
    });

    outroSubscriptionId = outraAssinatura.id;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [contexto.tenantId, outroContexto.tenantId] } } });
  });

  /** Cria um aluno com ou sem os dados que `faltaParaCartao` exige. */
  async function criarAluno(
    tenantId: string,
    gymUnitId: string,
    rotulo: string,
    opcoes: { comCpf: boolean; comEndereco: boolean },
  ): Promise<{ id: string }> {
    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: `M-${rotulo}`,
        fullName: `Aluno ${rotulo}`,
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
        cpf: opcoes.comCpf ? '52998224725' : null,
      },
      select: { id: true },
    });

    await db.studentContact.create({
      data: {
        tenantId,
        studentId: aluno.id,
        type: 'EMAIL',
        value: `${rotulo}@example.test`,
        isPrimary: true,
      },
    });

    if (opcoes.comEndereco) {
      await db.studentAddress.create({
        data: {
          tenantId,
          studentId: aluno.id,
          postalCode: '01310-100',
          street: 'Av. Paulista',
          number: '1000',
          district: 'Bela Vista',
          city: 'Sao Paulo',
          state: 'SP',
        },
      });
    }

    return aluno;
  }

  /** Abre uma invoice nova para um aluno com o cadastro pedido. */
  async function criarInvoiceAberta(
    opcoes: { cpfDoAluno: string | null } = { cpfDoAluno: '52998224725' },
  ): Promise<{ id: string; totalMinor: number }> {
    const rotulo = `${sufixo}-${randomUUID().slice(0, 6)}`;
    const aluno = await criarAluno(contexto.tenantId, unidadeId, rotulo, {
      comCpf: opcoes.cpfDoAluno !== null,
      comEndereco: true,
    });

    const assinatura = await db.subscription.create({
      data: {
        tenantId: contexto.tenantId,
        studentId: aluno.id,
        planId: planoId,
        status: 'ACTIVE',
        startsAt: new Date('2026-09-01T00:00:00Z'),
      },
      select: { id: true },
    });

    numeroDaInvoice += 1;

    const invoice = await db.invoice.create({
      data: {
        tenantId: contexto.tenantId,
        subscriptionId: assinatura.id,
        studentId: aluno.id,
        billingPeriod: new Date('2026-09-01T00:00:00Z'),
        number: numeroDaInvoice,
        status: 'OPEN',
        currency: 'BRL',
        subtotalMinor: 15000,
        totalMinor: 15000,
        dueAt: new Date('2026-09-10T12:00:00.000Z'),
      },
      select: { id: true, totalMinor: true },
    });

    return invoice;
  }

  async function criarInvoicePaga(): Promise<{ id: string }> {
    const invoice = await criarInvoiceAberta();

    await db.invoice.update({
      where: { id: invoice.id },
      data: { status: 'PAID', paidAt: AGORA },
    });

    return invoice;
  }

  async function criarInvoiceAbertaNoOutroTenant(): Promise<{ id: string }> {
    numeroDaInvoice += 1;

    const invoice = await db.invoice.create({
      data: {
        tenantId: outroContexto.tenantId,
        subscriptionId: outroSubscriptionId,
        studentId: (await db.subscription.findUniqueOrThrow({
          where: { id: outroSubscriptionId },
          select: { studentId: true },
        })).studentId,
        billingPeriod: new Date('2026-09-01T00:00:00Z'),
        number: numeroDaInvoice,
        status: 'OPEN',
        currency: 'BRL',
        subtotalMinor: 15000,
        totalMinor: 15000,
        dueAt: new Date('2026-09-10T12:00:00.000Z'),
      },
      select: { id: true },
    });

    return invoice;
  }

  it('cria o checkout e devolve link e QR', async () => {
    const invoice = await criarInvoiceAberta();

    const checkout = await useCase.executar(
      contexto,
      { invoiceId: invoice.id, agora: AGORA },
      'corr-1',
    );

    expect(checkout.checkoutUrl).toMatch(/^https:\/\//);
    expect(checkout.amountMinor).toBe(invoice.totalMinor);
  });

  /*
   * RECUSA ANTES DE CHAMAR O PROVEDOR. Nao e economia de rede: chamar a
   * Getnet sem CPF gasta requisicao para receber bloqueio de antifraude, e o
   * bloqueio chega como recusa generica -- a recepcao leria "nao foi
   * possivel" sem saber que o conserto e preencher o cadastro.
   */
  it('recusa aluno sem CPF sem tocar no provedor', async () => {
    const invoice = await criarInvoiceAberta({ cpfDoAluno: null });
    const chamadasAntes = fake.chamadasDeCheckout;

    await expect(
      useCase.executar(contexto, { invoiceId: invoice.id, agora: AGORA }, 'corr-2'),
    ).rejects.toMatchObject({ code: 'STUDENT_BILLING_DATA_INCOMPLETE' });

    expect(fake.chamadasDeCheckout).toBe(chamadasAntes);
  });

  it('invoice ja paga nao aceita checkout', async () => {
    const invoice = await criarInvoicePaga();

    await expect(
      useCase.executar(contexto, { invoiceId: invoice.id, agora: AGORA }, 'corr-3'),
    ).rejects.toMatchObject({ code: 'INVOICE_NOT_CHARGEABLE' });
  });

  /*
   * ISOLAMENTO: 404, nunca 409. Responder conflito para id de outro tenant
   * confirmaria que aquele id existe em algum lugar -- oraculo de existencia
   * entre academias (INV-006). E a licao da F17, onde o teste passava com o
   * status errado pela causa errada: exija o CODIGO, nao so o status.
   */
  it('invoice de outro tenant e 404, nunca 409', async () => {
    const invoiceDoOutro = await criarInvoiceAbertaNoOutroTenant();

    await expect(
      useCase.executar(contexto, { invoiceId: invoiceDoOutro.id, agora: AGORA }, 'corr-4'),
    ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND', status: 404 });
  });

  /*
   * CONCORRENCIA pelo caso de uso -- a sonda da Task 3 mediu o banco; esta
   * mede o caminho inteiro, que e o que a recepcao exercita com clique duplo.
   *
   * INSTANTES DISTINTOS de proposito (`AGORA` e `AGORA + 1ms`): a chave de
   * idempotencia deriva de `agora.toISOString()`, entao chamar as duas com o
   * MESMO instante monta a MESMA chave -- e quem rejeitaria a segunda seria
   * o unique `(tenantId, idempotencyKey)`, nao o indice parcial que este
   * teste existe para provar. Medido: com chave identica, o teste passava
   * mesmo com o indice derrubado (achado da revisao, round 1).
   */
  it('duas requisicoes concorrentes produzem UM checkout', async () => {
    const invoice = await criarInvoiceAberta();
    const AGORA_B = new Date(AGORA.getTime() + 1);

    const resultados = await Promise.allSettled([
      useCase.executar(contexto, { invoiceId: invoice.id, agora: AGORA }, 'corr-5a'),
      useCase.executar(contexto, { invoiceId: invoice.id, agora: AGORA_B }, 'corr-5b'),
    ]);

    const sucessos = resultados.filter((r) => r.status === 'fulfilled').length;
    const tentativas = await db.paymentAttempt.count({
      where: { tenantId: contexto.tenantId, invoiceId: invoice.id, method: 'CARD' },
    });

    expect({ sucessos, tentativas }).toEqual({ sucessos: 1, tentativas: 1 });

    /**
     * O TIPO do erro da perdedora, nao so a contagem: `sucessos: 1` sozinho
     * e satisfeito por QUALQUER falha na segunda chamada -- inclusive uma FK
     * quebrada que nao tem nada a ver com o indice. Mesmo padrao da F14
     * (`billing-cartao-e-recorrencia.int-spec.ts`).
     */
    const perdedora = resultados.find((r) => r.status === 'rejected');
    expect(perdedora).toBeDefined();
    if (perdedora?.status === 'rejected') {
      expect(perdedora.reason).toBeInstanceOf(CheckoutJaEmAndamentoError);
    }
  });

  /*
   * EXPIRACAO: decisao do PI (round 1). Uma tentativa presa em `CREATED` --
   * processo morto antes do `update` que grava `externalPaymentId`, ou aluno
   * que nunca abriu o link -- nao pode travar a fatura contra cartao para
   * sempre. A saida e a tentativa vencida virar terminal e sair do predicado
   * do indice parcial, nao o reuso que o PIX faz (link vencido nao serve).
   */
  it('tentativa CREATED com expiresAt no passado NAO bloqueia checkout novo', async () => {
    const invoice = await criarInvoiceAberta();

    await db.paymentAttempt.create({
      data: {
        tenantId: contexto.tenantId,
        invoiceId: invoice.id,
        method: 'CARD',
        status: 'CREATED',
        idempotencyKey: `presa-vencida:${sufixo}:${randomUUID().slice(0, 6)}`,
        expiresAt: new Date(AGORA.getTime() - 60 * 1000),
      },
    });

    const checkout = await useCase.executar(
      contexto,
      { invoiceId: invoice.id, agora: AGORA },
      'corr-expirada',
    );

    expect(checkout.checkoutUrl).toMatch(/^https:\/\//);

    const tentativas = await db.paymentAttempt.findMany({
      where: { tenantId: contexto.tenantId, invoiceId: invoice.id, method: 'CARD' },
      select: { status: true, failureCode: true },
    });

    expect(tentativas).toHaveLength(2);
    expect(tentativas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'FAILED', failureCode: 'CARD_CHECKOUT_EXPIRED' }),
        expect.objectContaining({ status: 'CREATED' }),
      ]),
    );
  });

  it('tentativa CREATED com expiresAt no futuro bloqueia checkout novo (409)', async () => {
    const invoice = await criarInvoiceAberta();

    await db.paymentAttempt.create({
      data: {
        tenantId: contexto.tenantId,
        invoiceId: invoice.id,
        method: 'CARD',
        status: 'CREATED',
        idempotencyKey: `presa-viva:${sufixo}:${randomUUID().slice(0, 6)}`,
        expiresAt: new Date(AGORA.getTime() + 60 * 1000),
      },
    });

    await expect(
      useCase.executar(contexto, { invoiceId: invoice.id, agora: AGORA }, 'corr-viva'),
    ).rejects.toMatchObject({ code: 'CARD_CHECKOUT_ALREADY_IN_FLIGHT', status: 409 });

    const tentativas = await db.paymentAttempt.count({
      where: { tenantId: contexto.tenantId, invoiceId: invoice.id, method: 'CARD' },
    });
    expect(tentativas).toBe(1);
  });

  /*
   * ORDEM DETERMINISTICA: sem `orderBy` explicito, `addresses[0]` pega a
   * ordem FISICA do Postgres, que muda apos qualquer `UPDATE` -- aluno com
   * dois enderecos mandaria ao antifraude o que o banco devolvesse primeiro
   * naquele dia. O caso de uso ordena por `createdAt desc`; este teste cria
   * dois enderecos, em ordem, e prova -- pelo que realmente chega ao
   * provedor -- que o mais recente e sempre o escolhido.
   */
  it('aluno com dois enderecos manda o mais recente ao provedor', async () => {
    const invoice = await criarInvoiceAberta();
    const { studentId } = await db.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      select: { studentId: true },
    });

    // `criarInvoiceAberta` ja deixou um endereco (Av. Paulista). Este e o
    // segundo, criado DEPOIS -- o que `createdAt desc` deve escolher.
    await db.studentAddress.create({
      data: {
        tenantId: contexto.tenantId,
        studentId,
        postalCode: '04538-133',
        street: 'Av. Brigadeiro Faria Lima',
        number: '2000',
        district: 'Itaim Bibi',
        city: 'Sao Paulo',
        state: 'SP',
      },
    });

    const espiao = jest.spyOn(fake, 'createHostedCheckout');

    await useCase.executar(contexto, { invoiceId: invoice.id, agora: AGORA }, 'corr-endereco');

    expect(espiao.mock.calls[0]?.[0].customer.endereco.logradouro).toBe(
      'Av. Brigadeiro Faria Lima',
    );

    espiao.mockRestore();
  });

  /*
   * `isPrimary` sozinho NAO e ordem total -- e boolean, entao dois contatos
   * do MESMO tipo com o MESMO `isPrimary` (dois EMAIL, ambos nao-primarios)
   * empatam e caem de volta na ordem FISICA do Postgres (achado da revisao,
   * round 2: o mesmo defeito do endereco, do lado do contato -- e o e-mail
   * que sai daqui vai para o antifraude do provedor). `createdAt desc`
   * desempata; este teste planta o empate e prova -- pelo que chega ao
   * provedor -- que o mais recente vence sempre.
   */
  it('aluno com dois contatos empatados em isPrimary manda o mais recente ao provedor', async () => {
    const invoice = await criarInvoiceAberta();
    const { studentId } = await db.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      select: { studentId: true },
    });

    // `criarAluno` ja deixou um EMAIL `isPrimary: true` -- este segundo
    // EMAIL, tambem `isPrimary: true` e criado DEPOIS, monta o empate real
    // no topo do `orderBy`: os dois batem em `isPrimary`, e so `createdAt`
    // pode decidir.
    await db.studentContact.create({
      data: {
        tenantId: contexto.tenantId,
        studentId,
        type: 'EMAIL',
        value: 'mais-novo@example.test',
        isPrimary: true,
      },
    });

    const espiao = jest.spyOn(fake, 'createHostedCheckout');

    await useCase.executar(contexto, { invoiceId: invoice.id, agora: AGORA }, 'corr-contato');

    // Sem o desempate por `createdAt`, a escolha entre os dois `isPrimary:
    // true` cairia na ordem fisica do Postgres -- o mais novo e o unico
    // resultado que prova que `createdAt desc` decidiu.
    expect(espiao.mock.calls[0]?.[0].customer.email).toBe('mais-novo@example.test');

    espiao.mockRestore();
  });
});
