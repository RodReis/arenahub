import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PROVEDOR_FAKE } from '../../src/modules/billing/provider/fake-payment-provider.adapter.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F25 -- Financeiro mobile (Slice 4.3).
 *
 * PELA PORTA HTTP e contra Postgres de verdade, mesmo motivo da F23/F24: os
 * casos de uso do MVP 2 que este BFF reusa (`CriarCobrancaPixUseCase`,
 * `CriarCheckoutDeCartaoUseCase`, `ConsultarTentativaUseCase`,
 * `EmitirReciboUseCase`) fazem escrita real em `payment_attempts`/`invoices`
 * e a idempotencia deles (indice parcial, reuso de tentativa PENDING) so e
 * provada contra banco real -- um dublê provaria o `if`, nao a constraint.
 *
 * `M4-BR-001`/INV-081: o teste central desta suite e que o retorno da
 * criacao do PIX NAO confirma nada -- so o `ConsultarTentativaUseCase`
 * (alimentado pelo webhook em outra suite) confirmaria.
 */
describe('F25 -- Financeiro do app do aluno', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;

  const sufixo = randomUUID().slice(0, 8);
  const SLUG = `f25-${sufixo}`;
  const EMAIL = `aluno-f25-${sufixo}@exemplo.test`;
  const EMAIL_OUTRO = `aluno-f25-outro-${sufixo}@exemplo.test`;
  const SENHA = 'senha-de-teste-f25-longa';
  const CONTA_PIX = `acct_f25_pix_${sufixo}`;

  let tenantId: string;
  let planId: string;
  let subscriptionId: string;
  let invoiceId: string;
  /** Invoice de OUTRO aluno, no MESMO tenant -- prova a checagem de posse. */
  let invoiceDeOutroAluno: string;

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  interface CorpoDeInvoices {
    asOf: string;
    invoices: { invoiceId: string; status: string; valorEmCentavos: number; moeda: string }[];
  }

  interface CorpoDeCobranca {
    paymentAttemptId: string;
    qrCodeDataUri: string;
    copiaECola: string | null;
    checkoutUrl: string | null;
    expiraEm: string;
    valorEmCentavos: number;
    moeda: string;
  }

  interface CorpoDeTentativa {
    paymentAttemptId: string;
    status: string;
    statusDaFatura: string;
    pagoEm: string | null;
  }

  const entrar = async (identificador = EMAIL): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/mobile/auth/login')
      .send({ tenantSlug: SLUG, identificador, senha: SENHA });

    return (resposta.body as { accessToken: string }).accessToken;
  };

  const criarAlunoComConta = async (
    identifier: string,
    nome: string,
    matricula: string,
    unidadeId: string,
  ): Promise<string> => {
    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId: unidadeId,
        membershipNumber: `${matricula}-${sufixo}`,
        fullName: nome,
        birthDate: new Date('1990-01-01'),
      },
    });

    await db.studentAccount.create({
      data: {
        tenantId,
        studentId: aluno.id,
        identifier,
        passwordHash: await senhas.gerarHash(SENHA),
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    });

    return aluno.id;
  };

  /** Abre uma invoice OPEN para o aluno dado, com competencia propria por chamada. */
  let mesDoCaso = 0;
  const abrirInvoice = async (studentId: string, subId: string): Promise<string> => {
    mesDoCaso += 1;
    const billingPeriod = new Date(Date.UTC(2027, mesDoCaso, 1));

    const invoice = await db.invoice.create({
      data: {
        tenantId,
        subscriptionId: subId,
        studentId,
        billingPeriod,
        status: 'OPEN',
        number: mesDoCaso,
        subtotalMinor: 18_000,
        totalMinor: 18_000,
        dueAt: new Date(Date.UTC(2027, mesDoCaso, 10)),
      },
    });

    return invoice.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: { slug: SLUG, legalName: `Academia F25 ${sufixo} LTDA`, displayName: 'Academia F25' },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `F25-${sufixo}`,
        name: 'Unidade F25',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    await db.providerAccount.create({
      data: {
        tenantId,
        provider: PROVEDOR_FAKE,
        capability: 'PIX',
        externalAccountId: CONTA_PIX,
        signingSecretEncrypted: `segredo-${sufixo}`,
      },
    });

    const plano = await db.plan.create({ data: { tenantId, name: `Plano F25 ${sufixo}` } });
    planId = plano.id;

    await db.planPrice.create({
      data: {
        tenantId,
        planId,
        amountMinor: 18_000,
        validFrom: new Date('2026-01-01T00:00:00Z'),
      },
    });

    const alunoId = await criarAlunoComConta(EMAIL, 'Aluna F25', 'F25A', unidade.id);
    const outroAlunoId = await criarAlunoComConta(EMAIL_OUTRO, 'Aluno F25 Outro', 'F25B', unidade.id);

    const assinatura = await db.subscription.create({
      data: {
        tenantId,
        studentId: alunoId,
        planId,
        status: 'ACTIVE',
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
    });
    subscriptionId = assinatura.id;

    const assinaturaDoOutro = await db.subscription.create({
      data: {
        tenantId,
        studentId: outroAlunoId,
        planId,
        status: 'ACTIVE',
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
    });

    invoiceId = await abrirInvoice(alunoId, subscriptionId);
    invoiceDeOutroAluno = await abrirInvoice(outroAlunoId, assinaturaDoOutro.id);
  });

  afterAll(async () => {
    if (tenantId) await db.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await app?.close();
  });

  describe('GET /api/v1/mobile/invoices', () => {
    it('lista so as invoices do aluno da SESSAO', async () => {
      const acesso = await entrar();

      const resposta = await request(servidor())
        .get('/api/v1/mobile/invoices')
        .set('Authorization', `Bearer ${acesso}`);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as CorpoDeInvoices;
      const ids = corpo.invoices.map((i) => i.invoiceId);
      expect(ids).toContain(invoiceId);
      expect(ids).not.toContain(invoiceDeOutroAluno);
    });

    it('sem token responde 401', async () => {
      await request(servidor()).get('/api/v1/mobile/invoices').expect(401);
    });
  });

  describe('POST /api/v1/mobile/invoices/:id/pix', () => {
    it('recusa cobrar invoice de OUTRO aluno do mesmo tenant', async () => {
      const acesso = await entrar();

      const resposta = await request(servidor())
        .post(`/api/v1/mobile/invoices/${invoiceDeOutroAluno}/pix`)
        .set('Authorization', `Bearer ${acesso}`);

      expect(resposta.status).toBe(404);
    });

    it('cria a cobranca PIX da propria invoice', async () => {
      const acesso = await entrar();

      const resposta = await request(servidor())
        .post(`/api/v1/mobile/invoices/${invoiceId}/pix`)
        .set('Authorization', `Bearer ${acesso}`);

      expect(resposta.status).toBe(201);

      const corpo = resposta.body as CorpoDeCobranca;
      expect(corpo.paymentAttemptId).toBeTruthy();
      expect(corpo.copiaECola).toBeTruthy();
      expect(corpo.checkoutUrl).toBeNull();
      expect(corpo.valorEmCentavos).toBe(18_000);
    });

    it('chamar duas vezes reusa a MESMA tentativa -- nao duplica cobranca', async () => {
      /*
       * `M4-AC-005`: "pagamento iniciado duas vezes com a mesma chave nao
       * duplica cobranca logica". Fechar e reabrir o app repete esta mesma
       * chamada -- a garantia mora no `CriarCobrancaPixUseCase` (reuso de
       * tentativa PROCESSING), e este teste prova que o BFF nao a contorna.
       */
      const acesso = await entrar();
      const assinatura = await db.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      const invoiceProprio = await abrirInvoice(assinatura.studentId, subscriptionId);

      const primeira = await request(servidor())
        .post(`/api/v1/mobile/invoices/${invoiceProprio}/pix`)
        .set('Authorization', `Bearer ${acesso}`);

      const segunda = await request(servidor())
        .post(`/api/v1/mobile/invoices/${invoiceProprio}/pix`)
        .set('Authorization', `Bearer ${acesso}`);

      expect(primeira.status).toBe(201);
      expect(segunda.status).toBe(201);
      expect((segunda.body as CorpoDeCobranca).paymentAttemptId).toBe(
        (primeira.body as CorpoDeCobranca).paymentAttemptId,
      );
    });

    it('sem token responde 401', async () => {
      await request(servidor()).post(`/api/v1/mobile/invoices/${invoiceId}/pix`).expect(401);
    });
  });

  describe('GET /api/v1/mobile/payment-attempts/:id', () => {
    it('recusa observar tentativa de invoice de OUTRO aluno', async () => {
      /*
       * A tentativa nasce na invoice do OUTRO aluno (via o proprio login
       * dele) e o aluno original tenta observa-la trocando o UUID -- prova
       * a checagem de posse do `MobileFinanceiroService.observarTentativa`.
       */
      const acessoDoOutro = await entrar(EMAIL_OUTRO);

      const cobranca = await request(servidor())
        .post(`/api/v1/mobile/invoices/${invoiceDeOutroAluno}/pix`)
        .set('Authorization', `Bearer ${acessoDoOutro}`);

      expect(cobranca.status).toBe(201);
      const attemptId = (cobranca.body as CorpoDeCobranca).paymentAttemptId;

      const resposta = await request(servidor())
        .get(`/api/v1/mobile/payment-attempts/${attemptId}`)
        .set('Authorization', `Bearer ${await entrar()}`);

      expect(resposta.status).toBe(404);
    });

    it('le PROCESSING logo apos criar o PIX -- ainda NAO confirmado', async () => {
      const acesso = await entrar();

      const cobranca = await request(servidor())
        .post(`/api/v1/mobile/invoices/${invoiceId}/pix`)
        .set('Authorization', `Bearer ${acesso}`);

      const attemptId = (cobranca.body as CorpoDeCobranca).paymentAttemptId;

      const resposta = await request(servidor())
        .get(`/api/v1/mobile/payment-attempts/${attemptId}`)
        .set('Authorization', `Bearer ${acesso}`);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as CorpoDeTentativa;
      // `M4-BR-001`/INV-081: o retorno da criacao NUNCA confirma sozinho.
      expect(corpo.status).not.toBe('SUCCEEDED');
      expect(corpo.pagoEm).toBeNull();
    });

    it('sem token responde 401', async () => {
      await request(servidor()).get('/api/v1/mobile/payment-attempts/qualquer').expect(401);
    });
  });
});
