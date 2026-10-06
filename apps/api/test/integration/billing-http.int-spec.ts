import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F12 -- endpoints do financeiro (Slice 2.1).
 *
 * O foco aqui e o que SO o HTTP prova:
 *
 *   - `billing.payment.manual` e permissao SEPARADA de `billing.manage`.
 *     Quem administra cobranca nao reconhece dinheiro no balcao por
 *     tabela -- e decisao desta fatia, entao precisa de teste, senao a
 *     separacao existe so no comentario;
 *   - o Zod recusa valor fracionario ANTES do dominio (INV-065);
 *   - abrir a mesma invoice duas vezes pelo endpoint devolve o mesmo
 *     numero (clique duplo nao cobra duas vezes).
 */
describe('F12 -- endpoints de invoice e pagamento manual', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-financeiro';
  const PRECO_MINOR = 15_000;

  const cenario = {
    tenantId: '',
    subscriptionId: '',
    studentId: '',
    /** Tem `billing.read` + `billing.manage`, NAO tem o pagamento manual. */
    cookieGestor: '',
    /** Tem os tres. */
    cookieCaixa: '',
  };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  /** Cria usuario com exatamente as permissoes pedidas e devolve o cookie. */
  async function criarUsuarioCom(
    rotulo: string,
    codigos: readonly string[],
  ): Promise<{ id: string; cookie: string }> {
    const usuario = await db.user.create({
      data: {
        email: `f12-${rotulo}-${sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash(SENHA),
      },
    });

    await db.tenantMembership.create({
      data: { tenantId: cenario.tenantId, userId: usuario.id },
    });

    const papel = await db.role.create({
      data: { tenantId: cenario.tenantId, name: `PAPEL_${rotulo}_${sufixo}`, isSystem: false },
    });

    for (const code of codigos) {
      const permissao = await db.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });

      await db.rolePermission.create({
        data: { roleId: papel.id, permissionId: permissao.id },
      });
    }

    await db.userRole.create({
      data: { tenantId: cenario.tenantId, userId: usuario.id, roleId: papel.id },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: usuario.email, password: SENHA });

    return { id: usuario.id, cookie: cookieDeAcesso(login) };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `f12-${sufixo}`,
        legalName: `Financeiro ${sufixo} LTDA`,
        displayName: `Financeiro ${sufixo}`,
      },
    });
    cenario.tenantId = tenant.id;

    // F53, task 16: checkout hospedado de cartao precisa de conta ativa de
    // CARD (`ProviderAccountResolver`) -- sem ela, a rota devolve 409
    // `PROVIDER_ACCOUNT_MISSING` em vez do fluxo que o teste quer provar.
    await db.providerAccount.create({
      data: {
        tenantId: tenant.id,
        provider: 'getnet',
        capability: 'CARD',
        externalAccountId: `ACC-CARD-${sufixo}`,
        signingSecretEncrypted: 'nao-sai-deste-arquivo',
      },
    });

    // A F45 tornou `students.gym_unit_id` obrigatorio: todo aluno nasce numa
    // unidade de origem. Cobranca nao consulta unidade -- ela existe aqui so
    // para o aluno da fixture ser valido.
    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: `UNI-${sufixo}`,
        name: 'Unidade da fixture',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Plano F12 ${sufixo}` },
    });

    await db.planPrice.create({
      data: {
        tenantId: tenant.id,
        planId: plano.id,
        amountMinor: PRECO_MINOR,
        validFrom: new Date('2026-01-01T00:00:00Z'),
      },
    });

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        fullName: 'Aluno F12',
        membershipNumber: `f12-${sufixo}`,
        birthDate: new Date('1990-05-20T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
    cenario.studentId = aluno.id;

    const assinatura = await db.subscription.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        planId: plano.id,
        status: 'ACTIVE',
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
    });
    cenario.subscriptionId = assinatura.id;

    await db.billingSettings.create({
      data: { tenantId: tenant.id, dueDay: 10, graceDays: 5 },
    });

    const gestor = await criarUsuarioCom('gestor', ['billing.read', 'billing.manage']);
    cenario.cookieGestor = gestor.cookie;

    const caixa = await criarUsuarioCom('caixa', [
      'billing.read',
      'billing.manage',
      'billing.payment.manual',
    ]);
    cenario.cookieCaixa = caixa.cookie;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: cenario.tenantId } });
    await db.user.deleteMany({ where: { email: { contains: `f12-` } } });
    await app.close();
  });

  it('abre a invoice pelo endpoint', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/invoices')
      .set('Cookie', cenario.cookieGestor)
      .send({ subscriptionId: cenario.subscriptionId, emQue: '2026-08-18T12:00:00.000Z' });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({
      status: 'OPEN',
      number: 1,
      totalMinor: PRECO_MINOR,
    });
  });

  it('abrir de novo devolve o MESMO numero -- clique duplo nao cobra duas vezes', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/invoices')
      .set('Cookie', cenario.cookieGestor)
      .send({ subscriptionId: cenario.subscriptionId, emQue: '2026-08-25T09:00:00.000Z' });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ number: 1 });
  });

  it('quem tem billing.manage mas NAO billing.payment.manual e barrado', async () => {
    const invoice = await db.invoice.findFirstOrThrow({ where: { tenantId: cenario.tenantId } });

    const resposta = await request(servidor())
      .post(`/api/v1/invoices/${invoice.id}/manual-payment`)
      .set('Cookie', cenario.cookieGestor)
      .send({
        amountMinor: PRECO_MINOR,
        paidAt: '2026-08-09T10:00:00.000Z',
        reason: 'tentativa sem permissao',
        receivedVia: 'DINHEIRO',
      });

    expect(resposta.status).toBe(403);
  });

  it('valor fracionario e recusado pelo Zod antes do dominio (INV-065)', async () => {
    const invoice = await db.invoice.findFirstOrThrow({ where: { tenantId: cenario.tenantId } });

    const resposta = await request(servidor())
      .post(`/api/v1/invoices/${invoice.id}/manual-payment`)
      .set('Cookie', cenario.cookieCaixa)
      .send({
        amountMinor: 150.5,
        paidAt: '2026-08-09T10:00:00.000Z',
        reason: 'valor com centavo fracionario',
        receivedVia: 'DINHEIRO',
      });

    expect(resposta.status).toBe(400);
  });

  it('o caixa registra o pagamento e a invoice fica paga', async () => {
    const invoice = await db.invoice.findFirstOrThrow({ where: { tenantId: cenario.tenantId } });

    const resposta = await request(servidor())
      .post(`/api/v1/invoices/${invoice.id}/manual-payment`)
      .set('Cookie', cenario.cookieCaixa)
      .send({
        amountMinor: PRECO_MINOR,
        paidAt: '2026-08-09T10:00:00.000Z',
        reason: 'dinheiro na recepcao',
        receivedVia: 'DINHEIRO',
      });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ status: 'PAID' });

    const corpo = resposta.body as {
      payments: { recognizedByUserId: string | null; receivedVia: string | null }[];
    };
    expect(corpo.payments).toHaveLength(1);
    // A mitigacao detectiva: o dinheiro manual fica ligado a uma pessoa.
    expect(corpo.payments[0]?.recognizedByUserId).not.toBeNull();
    expect(corpo.payments[0]?.receivedVia).toBe('DINHEIRO');
  });

  it('lista as invoices do aluno, com o fuso da unidade de origem', async () => {
    const resposta = await request(servidor())
      .get(`/api/v1/students/${cenario.studentId}/invoices`)
      .set('Cookie', cenario.cookieGestor);

    expect(resposta.status).toBe(200);
    // F53, task 7: o corpo deixou de ser array e passou a { timezone, invoices }.
    const corpo = resposta.body as { timezone: string; invoices: unknown[] };
    expect(corpo.timezone).toBe('America/Sao_Paulo');
    expect(corpo.invoices).toHaveLength(1);
  });

  /**
   * F83, issue #458 -- pagamento em lote no balcao. O caso de uso ja e
   * coberto direto em `billing-pagamento-em-lote.int-spec.ts`; aqui o foco
   * e SO o que a porta HTTP acrescenta, como nas demais rotas deste
   * arquivo: autenticacao/permissao por cookie e a traducao do erro de
   * dominio para status HTTP certo.
   */
  describe('pagamento em lote', () => {
    it('consulta a faixa de meses pagaveis da assinatura', async () => {
      const resposta = await request(servidor())
        .get(`/api/v1/subscriptions/${cenario.subscriptionId}/payable-months`)
        .set('Cookie', cenario.cookieGestor);

      expect(resposta.status).toBe(200);
      const corpo = resposta.body as { months: { competencia: string; status: string }[] };
      expect(Array.isArray(corpo.months)).toBe(true);
      expect(corpo.months.length).toBeGreaterThan(0);
    });

    it('lote sem o header Idempotency-Key e recusado com 422', async () => {
      const resposta = await request(servidor())
        .post(`/api/v1/subscriptions/${cenario.subscriptionId}/manual-payment-batch`)
        .set('Cookie', cenario.cookieCaixa)
        .send({
          competencias: ['2026-09'],
          paidAt: '2026-09-15',
          channel: 'DINHEIRO',
          expectedTotalMinor: PRECO_MINOR,
        });

      expect(resposta.status).toBe(422);
    });
  });

  /**
   * F53, task 16 -- o buraco entre o caso de uso (task 9, ja testado em
   * `checkout-de-cartao.int-spec.ts`) e a rota HTTP que o balcao chama.
   * `checkout-de-cartao.int-spec.ts` cobre o caso de uso direto; aqui o foco
   * e SO o que a porta HTTP acrescenta: autenticacao por cookie e a
   * traducao do erro de dominio para status HTTP certo.
   */
  describe('checkout hospedado de cartao', () => {
    /** Aluno com CPF e endereco -- passa pela recusa de cadastro incompleto. */
    async function criarAlunoComCadastroCompleto(rotulo: string): Promise<{
      subscriptionId: string;
    }> {
      const unidade = await db.gymUnit.create({
        data: {
          tenantId: cenario.tenantId,
          code: `UNI-CC-${rotulo}`,
          name: 'Unidade checkout',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        },
      });

      const aluno = await db.student.create({
        data: {
          tenantId: cenario.tenantId,
          gymUnitId: unidade.id,
          fullName: `Aluno Checkout ${rotulo}`,
          membershipNumber: `f12-cc-${rotulo}`,
          birthDate: new Date('1990-05-20T00:00:00Z'),
          status: 'ACTIVE',
          cpf: '52998224725',
        },
      });

      await db.studentContact.create({
        data: {
          tenantId: cenario.tenantId,
          studentId: aluno.id,
          type: 'EMAIL',
          value: `checkout-${rotulo}@example.test`,
          isPrimary: true,
        },
      });

      await db.studentAddress.create({
        data: {
          tenantId: cenario.tenantId,
          studentId: aluno.id,
          postalCode: '01310-100',
          street: 'Av. Paulista',
          number: '1000',
          district: 'Bela Vista',
          city: 'Sao Paulo',
          state: 'SP',
        },
      });

      const { planId } = await db.subscription.findUniqueOrThrow({
        where: { id: cenario.subscriptionId },
        select: { planId: true },
      });

      const assinatura = await db.subscription.create({
        data: {
          tenantId: cenario.tenantId,
          studentId: aluno.id,
          planId,
          status: 'ACTIVE',
          startsAt: new Date('2026-08-01T00:00:00Z'),
        },
      });

      return { subscriptionId: assinatura.id };
    }

    async function abrirInvoice(subscriptionId: string, emQue: string): Promise<string> {
      const resposta = await request(servidor())
        .post('/api/v1/invoices')
        .set('Cookie', cenario.cookieGestor)
        .send({ subscriptionId, emQue });

      return (resposta.body as { id: string }).id;
    }

    it('cria o checkout pela porta da frente e devolve link e QR', async () => {
      const { subscriptionId } = await criarAlunoComCadastroCompleto('ok');
      const invoiceId = await abrirInvoice(subscriptionId, '2026-08-18T12:00:00.000Z');

      const resposta = await request(servidor())
        .post(`/api/v1/invoices/${invoiceId}/payments/card-checkout`)
        .set('Cookie', cenario.cookieGestor)
        .send();

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({
        checkoutUrl: expect.stringMatching(/^https:\/\//),
        amountMinor: PRECO_MINOR,
        currency: 'BRL',
      });
      const corpo = resposta.body as {
        paymentAttemptId: string;
        externalPaymentId: string;
        qrCodeDataUri: string;
        expiresAt: string;
      };
      expect(corpo.paymentAttemptId).toBeTruthy();
      expect(corpo.externalPaymentId).toBeTruthy();
      expect(corpo.qrCodeDataUri).toBeTruthy();
      expect(corpo.expiresAt).toBeTruthy();
    });

    it('aluno sem CPF devolve 422 com o codigo de cadastro incompleto, nao 500', async () => {
      const unidade = await db.gymUnit.create({
        data: {
          tenantId: cenario.tenantId,
          code: 'UNI-CC-SEMCPF',
          name: 'Unidade checkout sem cpf',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        },
      });

      const { planId } = await db.subscription.findUniqueOrThrow({
        where: { id: cenario.subscriptionId },
        select: { planId: true },
      });

      const aluno = await db.student.create({
        data: {
          tenantId: cenario.tenantId,
          gymUnitId: unidade.id,
          fullName: 'Aluno Checkout Sem Cpf',
          membershipNumber: 'f12-cc-semcpf',
          birthDate: new Date('1990-05-20T00:00:00Z'),
          status: 'ACTIVE',
          cpf: null,
        },
      });

      const assinatura = await db.subscription.create({
        data: {
          tenantId: cenario.tenantId,
          studentId: aluno.id,
          planId,
          status: 'ACTIVE',
          startsAt: new Date('2026-08-01T00:00:00Z'),
        },
      });

      const invoiceId = await abrirInvoice(assinatura.id, '2026-08-19T12:00:00.000Z');

      const resposta = await request(servidor())
        .post(`/api/v1/invoices/${invoiceId}/payments/card-checkout`)
        .set('Cookie', cenario.cookieGestor)
        .send();

      expect(resposta.status).toBe(422);
      expect(resposta.body).toMatchObject({ code: 'STUDENT_BILLING_DATA_INCOMPLETE' });
    });

    it('sem cookie de sessao e 401', async () => {
      const { subscriptionId } = await criarAlunoComCadastroCompleto('semauth');
      const invoiceId = await abrirInvoice(subscriptionId, '2026-08-20T12:00:00.000Z');

      const resposta = await request(servidor())
        .post(`/api/v1/invoices/${invoiceId}/payments/card-checkout`)
        .send();

      expect(resposta.status).toBe(401);
    });
  });

  /**
   * #581 e #583 -- hardening de cobranca da auditoria run-1. A correcao de
   * valor existe para restaurar o preco vigente do plano (#419); `billing.manage`
   * (que o Financeiro padrao tem, e `billing.payment.manual` nao) levava uma
   * fatura de 12000 a 1 e a 0. O Int32 vazava como 500.
   */
  describe('correcao de valor e datas do pagamento manual', () => {
    const PRECO_NOVO = 17_000;
    let invoiceId = '';

    const corrigir = (corpo: Record<string, unknown>) =>
      request(servidor())
        .post(`/api/v1/invoices/${invoiceId}/correct-amount`)
        .set('Cookie', cenario.cookieGestor)
        .send(corpo);

    const totalNoBanco = async (): Promise<number> =>
      (await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).totalMinor;

    beforeAll(async () => {
      const aberta = await request(servidor())
        .post('/api/v1/invoices')
        .set('Cookie', cenario.cookieGestor)
        .send({ subscriptionId: cenario.subscriptionId, emQue: '2026-09-12T12:00:00.000Z' });
      invoiceId = (aberta.body as { id: string }).id;

      // Reajuste que nao propagou: a invoice ja nasceu com 15000 e o preco
      // vigente na competencia passou a ser 17000.
      const plano = await db.plan.findFirstOrThrow({ where: { tenantId: cenario.tenantId } });
      await db.planPrice.create({
        data: {
          tenantId: cenario.tenantId,
          planId: plano.id,
          amountMinor: PRECO_NOVO,
          validFrom: new Date('2026-09-01T00:00:00Z'),
        },
      });
    });

    it('recusa valor diferente do preco vigente do plano', async () => {
      const resposta = await corrigir({ novoValorUnitarioMinor: 1, reason: 'tentativa de baixar' });

      expect(resposta.status).toBe(422);
      expect(resposta.body).toMatchObject({ code: 'BILLING_AMOUNT_NOT_PLAN_PRICE' });
      expect(await totalNoBanco()).toBe(PRECO_MINOR);
    });

    it('recusa zerar a fatura', async () => {
      const resposta = await corrigir({ novoValorUnitarioMinor: 0, reason: 'tentativa de zerar' });

      expect(resposta.status).toBe(422);
      expect(await totalNoBanco()).toBe(PRECO_MINOR);
    });

    it('valor acima do teto de Int e 4xx, nao 500', async () => {
      const resposta = await corrigir({
        novoValorUnitarioMinor: 999_999_999_999,
        reason: 'valor gigante',
      });

      expect(resposta.status).toBe(400);
    });

    it('aceita restaurar o preco vigente do plano', async () => {
      const resposta = await corrigir({
        novoValorUnitarioMinor: PRECO_NOVO,
        reason: 'reajuste nao propagou',
      });

      expect(resposta.status).toBe(201);
      expect(await totalNoBanco()).toBe(PRECO_NOVO);
    });

    it('pagamento manual com valor acima do teto de Int e 4xx, nao 500', async () => {
      const resposta = await request(servidor())
        .post(`/api/v1/invoices/${invoiceId}/manual-payment`)
        .set('Cookie', cenario.cookieCaixa)
        .send({
          amountMinor: 999_999_999_999,
          paidAt: new Date().toISOString(),
          reason: 'valor gigante',
          receivedVia: 'DINHEIRO',
        });

      expect(resposta.status).toBe(400);
    });

    it('pagamento manual com data futura e recusado', async () => {
      const amanha = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

      const resposta = await request(servidor())
        .post(`/api/v1/invoices/${invoiceId}/manual-payment`)
        .set('Cookie', cenario.cookieCaixa)
        .send({
          amountMinor: PRECO_NOVO,
          paidAt: amanha,
          reason: 'data no futuro',
          receivedVia: 'DINHEIRO',
        });

      expect(resposta.status).toBe(422);
      expect(resposta.body).toMatchObject({ code: 'BILLING_PAID_AT_IN_FUTURE' });
    });

    it('pagamento manual de AGORA continua passando (o painel manda o instante atual)', async () => {
      const resposta = await request(servidor())
        .post(`/api/v1/invoices/${invoiceId}/manual-payment`)
        .set('Cookie', cenario.cookieCaixa)
        .send({
          amountMinor: PRECO_NOVO,
          paidAt: new Date().toISOString(),
          reason: 'dinheiro na recepcao',
          receivedVia: 'DINHEIRO',
        });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ status: 'PAID' });
    });

    it('fatura paga nao aceita correcao', async () => {
      const resposta = await corrigir({
        novoValorUnitarioMinor: PRECO_NOVO,
        reason: 'depois de paga',
      });

      expect(resposta.status).toBe(422);
    });
  });
});
