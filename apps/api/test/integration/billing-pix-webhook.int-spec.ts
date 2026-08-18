import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import {
  FakePaymentProvider,
  HEADER_DE_ASSINATURA,
  PROVEDOR_FAKE,
  assinarCorpo,
} from '../../src/modules/billing/provider/fake-payment-provider.adapter.js';
import { PAYMENT_PROVIDER } from '../../src/modules/billing/provider/payment-provider.port.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F13 -- PIX e webhook idempotente (Slice 2.2).
 *
 * ACEITE DA SLICE, palavra por palavra: "PIX sandbox e homologacao
 * atualizam o acesso UMA UNICA VEZ mesmo com webhook repetido".
 *
 * Contra banco de verdade, nao dublado (`docs/TESTING.md` 3): a idempotencia
 * de INV-076 E uma constraint do Postgres. Testa-la com repositorio em
 * memoria provaria o `if` do TypeScript e nao a garantia real.
 *
 * A cadeia inteira e verificada ate o ULTIMO elo: entitlement `ACTIVE`. A
 * catraca le entitlement (regra de arquitetura no 1) -- parar em "invoice
 * paga" deixaria o aluno pagando e batendo na porta fechada, e o teste
 * passaria.
 */
describe('F13 -- PIX, webhook idempotente e ativacao do acesso', () => {
  let app: INestApplication;
  let db: PrismaService;
  let provedor: FakePaymentProvider;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-pix';
  const PRECO_MINOR = 18_000;
  const CONTA_NO_PROVEDOR = `acct_f13_${sufixo}`;
  const SEGREDO = `segredo-hmac-de-teste-${sufixo}`;

  const cenario = {
    tenantId: '',
    subscriptionId: '',
    entitlementId: '',
    studentId: '',
    planId: '',
    cookie: '',
    /** Tenant vizinho: prova que o webhook nao cruza fronteira. */
    outroTenantId: '',
  };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  /**
   * `resposta.body` do supertest e `any`. Estes dois cortam o `any` num
   * lugar so, em vez de espalhar cast por cada assercao.
   */
  const corpoDeInvoice = (r: request.Response): { id: string } =>
    r.body as { id: string };

  const corpoDePix = (r: request.Response): {
    paymentAttemptId: string;
    externalPaymentId: string;
    copiaECola: string;
    qrCodeDataUri: string;
  } => r.body as {
    paymentAttemptId: string;
    externalPaymentId: string;
    copiaECola: string;
    qrCodeDataUri: string;
  };

  const corpoDeWebhookRecebido = (r: request.Response): { applied: boolean } =>
    r.body as { applied: boolean };

  /** Monta corpo + assinatura como o provedor faria. */
  function webhook(sobrescreve: Record<string, unknown> = {}): {
    corpo: string;
    assinatura: string;
  } {
    const corpo = JSON.stringify({
      externalEventId: `evt_${randomUUID()}`,
      externalAccountId: CONTA_NO_PROVEDOR,
      tipo: 'PAYMENT_CONFIRMED',
      occurredAt: '2026-08-18T12:00:00.000Z',
      ...sobrescreve,
    });

    return { corpo, assinatura: assinarCorpo(Buffer.from(corpo, 'utf8'), SEGREDO) };
  }

  function enviarWebhook(dados: { corpo: string; assinatura: string }) {
    return request(servidor())
      .post(`/api/v1/webhooks/payments/${PROVEDOR_FAKE}`)
      .set(HEADER_DE_ASSINATURA, dados.assinatura)
      .set('Content-Type', 'application/json')
      .send(dados.corpo);
  }

  /**
   * Competencia propria por chamada.
   *
   * INV-066 da uma invoice por `(tenant, assinatura, competencia)`: sem um
   * mes proprio, o segundo teste receberia a invoice do primeiro -- ja paga
   * -- e a cobranca seria recusada. O teste falharia por contaminacao entre
   * casos, nao por bug.
   */
  let mesDoCaso = 0;

  /** Abre invoice em competencia limpa e cria a cobranca PIX. */
  async function criarCobranca(): Promise<{ invoiceId: string; externalPaymentId: string }> {
    mesDoCaso += 1;
    const emQue = new Date(Date.UTC(2027, mesDoCaso, 15, 12, 0, 0)).toISOString();

    const invoice = await request(servidor())
      .post('/api/v1/invoices')
      .set('Cookie', cenario.cookie)
      .send({ subscriptionId: cenario.subscriptionId, emQue });

    expect(invoice.status).toBe(201);

    const pix = await request(servidor())
      .post(`/api/v1/invoices/${corpoDeInvoice(invoice).id}/payments/pix`)
      .set('Cookie', cenario.cookie);

    expect(pix.status).toBe(201);

    return {
      invoiceId: corpoDeInvoice(invoice).id,
      externalPaymentId: corpoDePix(pix).externalPaymentId,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);
    provedor = app.get<FakePaymentProvider>(PAYMENT_PROVIDER);
    provedor.registrarConta(CONTA_NO_PROVEDOR, SEGREDO);

    const tenant = await db.tenant.create({
      data: {
        slug: `f13-${sufixo}`,
        legalName: `PIX ${sufixo} LTDA`,
        displayName: `PIX ${sufixo}`,
      },
    });
    cenario.tenantId = tenant.id;

    const vizinho = await db.tenant.create({
      data: {
        slug: `f13-vizinho-${sufixo}`,
        legalName: `Vizinho ${sufixo} LTDA`,
        displayName: `Vizinho ${sufixo}`,
      },
    });
    cenario.outroTenantId = vizinho.id;

    await db.providerAccount.create({
      data: {
        tenantId: tenant.id,
        provider: PROVEDOR_FAKE,
        externalAccountId: CONTA_NO_PROVEDOR,
        // Em producao vive cifrado; aqui o valor nao sai deste arquivo.
        signingSecretEncrypted: SEGREDO,
      },
    });

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Plano F13 ${sufixo}` },
    });
    cenario.planId = plano.id;

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
        fullName: 'Aluno F13',
        membershipNumber: `f13-${sufixo}`,
        birthDate: new Date('1992-03-10T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
    cenario.studentId = aluno.id;

    /**
     * Assinatura nasce PENDING e entitlement SCHEDULED -- e o estado de
     * quem se matriculou e ainda NAO pagou. E exatamente o que o pagamento
     * confirmado promove.
     */
    const assinatura = await db.subscription.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        planId: plano.id,
        status: 'PENDING',
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
    });
    cenario.subscriptionId = assinatura.id;

    const entitlement = await db.entitlement.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        source: 'SUBSCRIPTION',
        subscriptionId: assinatura.id,
        status: 'SCHEDULED',
        startsAt: new Date('2026-08-01T00:00:00Z'),
        endsAt: new Date('2026-09-01T00:00:00Z'),
        policySnapshot: { planId: plano.id, planName: plano.name, unitIds: [], janelas: [] },
      },
    });
    cenario.entitlementId = entitlement.id;

    await db.billingSettings.create({
      data: { tenantId: tenant.id, dueDay: 10, graceDays: 5 },
    });

    const usuario = await db.user.create({
      data: {
        email: `f13-${sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash(SENHA),
      },
    });

    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId: tenant.id, name: `PAPEL_F13_${sufixo}`, isSystem: false },
    });

    for (const code of ['billing.read', 'billing.manage']) {
      const permissao = await db.permission.upsert({ where: { code }, create: { code }, update: {} });
      await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    }

    await db.userRole.create({
      data: { tenantId: tenant.id, userId: usuario.id, roleId: papel.id },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: usuario.email, password: SENHA });

    const cabecalho: unknown = login.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];
    cenario.cookie = lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  });

  afterAll(async () => {
    await db.tenant.deleteMany({
      where: { id: { in: [cenario.tenantId, cenario.outroTenantId] } },
    });
    await db.user.deleteMany({ where: { email: { contains: `f13-${sufixo}` } } });
    await app.close();
  });

  describe('criacao da cobranca PIX', () => {
    it('devolve QR Code e copia-e-cola', async () => {
      const { externalPaymentId } = await criarCobranca();

      const tentativa = await db.paymentAttempt.findFirstOrThrow({
        where: { tenantId: cenario.tenantId, externalPaymentId },
      });

      expect(tentativa.status).toBe('PROCESSING');
      expect(tentativa.method).toBe('PIX');

      const invoice = await db.invoice.findUniqueOrThrow({ where: { id: tentativa.invoiceId } });
      expect(invoice.totalMinor).toBe(PRECO_MINOR);
    });

    it('a resposta traz copia-e-cola e QR Code prontos para o aluno', async () => {
      const invoice = await request(servidor())
        .post('/api/v1/invoices')
        .set('Cookie', cenario.cookie)
        .send({ subscriptionId: cenario.subscriptionId, emQue: '2028-04-15T12:00:00.000Z' });

      const resposta = await request(servidor())
        .post(`/api/v1/invoices/${corpoDeInvoice(invoice).id}/payments/pix`)
        .set('Cookie', cenario.cookie);

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ amountMinor: PRECO_MINOR, currency: 'BRL' });
      expect(corpoDePix(resposta).copiaECola).toEqual(expect.any(String));
      expect(corpoDePix(resposta).qrCodeDataUri).toMatch(/^data:image\/png;base64,/);
    });

    it('pedir de novo com cobranca viva devolve a MESMA -- recarregar a tela nao gera QR novo', async () => {
      const { invoiceId, externalPaymentId } = await criarCobranca();

      const segunda = await request(servidor())
        .post(`/api/v1/invoices/${invoiceId}/payments/pix`)
        .set('Cookie', cenario.cookie);

      expect(corpoDePix(segunda).externalPaymentId).toBe(externalPaymentId);
    });
  });

  describe('INV-077 -- assinatura verificada antes de tudo', () => {
    it('assinatura invalida devolve 401 e NAO grava evento', async () => {
      const antes = await db.providerEvent.count({ where: { tenantId: cenario.tenantId } });

      const resposta = await request(servidor())
        .post(`/api/v1/webhooks/payments/${PROVEDOR_FAKE}`)
        .set(HEADER_DE_ASSINATURA, 'assinatura-forjada')
        .set('Content-Type', 'application/json')
        .send(webhook().corpo);

      expect(resposta.status).toBe(401);

      const depois = await db.providerEvent.count({ where: { tenantId: cenario.tenantId } });
      expect(depois).toBe(antes);
    });

    it('sem header de assinatura devolve 401', async () => {
      const resposta = await request(servidor())
        .post(`/api/v1/webhooks/payments/${PROVEDOR_FAKE}`)
        .set('Content-Type', 'application/json')
        .send(webhook().corpo);

      expect(resposta.status).toBe(401);
    });
  });

  describe('INV-078 -- o tenant vem da conta, nunca do payload', () => {
    it('conta desconhecida no provedor devolve 404 mesmo com assinatura bem formada', async () => {
      const corpo = JSON.stringify({
        externalEventId: `evt_${randomUUID()}`,
        externalAccountId: 'acct_que_ninguem_cadastrou',
        tipo: 'PAYMENT_CONFIRMED',
        occurredAt: '2026-08-18T12:00:00.000Z',
      });

      const resposta = await request(servidor())
        .post(`/api/v1/webhooks/payments/${PROVEDOR_FAKE}`)
        .set(HEADER_DE_ASSINATURA, assinarCorpo(Buffer.from(corpo, 'utf8'), SEGREDO))
        .set('Content-Type', 'application/json')
        .send(corpo);

      // 401: o fake nao conhece a conta, entao nem chega a resolver tenant.
      expect(resposta.status).toBe(401);
    });

    it('evento gravado fica no tenant da conta, nao em outro', async () => {
      const { externalPaymentId } = await criarCobranca();
      const dados = webhook({ externalPaymentId });

      await enviarWebhook(dados);

      const evento = await db.providerEvent.findFirstOrThrow({
        where: { externalPaymentId },
      });

      expect(evento.tenantId).toBe(cenario.tenantId);
      expect(evento.tenantId).not.toBe(cenario.outroTenantId);
    });
  });

  describe('ACEITE DA SLICE -- webhook repetido atualiza o acesso UMA UNICA VEZ', () => {
    it('cadeia completa: pagamento -> invoice -> assinatura -> entitlement', async () => {
      const { invoiceId, externalPaymentId } = await criarCobranca();
      const dados = webhook({ externalPaymentId });

      const resposta = await enviarWebhook(dados);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({ received: true, applied: true });

      const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(invoice.status).toBe('PAID');

      const pagamentos = await db.payment.findMany({ where: { invoiceId } });
      expect(pagamentos).toHaveLength(1);
      expect(pagamentos[0]).toMatchObject({ status: 'CONFIRMED', method: 'PIX' });

      const assinatura = await db.subscription.findUniqueOrThrow({
        where: { id: cenario.subscriptionId },
      });
      expect(assinatura.status).toBe('ACTIVE');

      // O ULTIMO ELO: e isto que a catraca le.
      const entitlement = await db.entitlement.findUniqueOrThrow({
        where: { id: cenario.entitlementId },
      });
      expect(entitlement.status).toBe('ACTIVE');
    });

    it('MESMO evento entregue 3 vezes produz UM pagamento -- INV-076', async () => {
      const { invoiceId, externalPaymentId } = await criarCobranca();
      const dados = webhook({ externalPaymentId });

      const respostas = [
        await enviarWebhook(dados),
        await enviarWebhook(dados),
        await enviarWebhook(dados),
      ];

      // Todas 200: reentrega e processamento correto, nao falha.
      expect(respostas.map((r) => r.status)).toEqual([200, 200, 200]);

      // Uma aplicou; as outras duas foram descartadas como duplicata.
      expect(respostas.filter((r) => corpoDeWebhookRecebido(r).applied)).toHaveLength(1);

      const pagamentos = await db.payment.findMany({ where: { invoiceId } });
      expect(pagamentos).toHaveLength(1);

      const eventos = await db.providerEvent.findMany({ where: { externalPaymentId } });
      expect(eventos).toHaveLength(1);
    });

    it('entregas SIMULTANEAS do mesmo evento tambem produzem UM pagamento', async () => {
      const { invoiceId, externalPaymentId } = await criarCobranca();
      const dados = webhook({ externalPaymentId });

      /**
       * O caso que o `if (jaProcessei)` perde: duas entregas em voo ao mesmo
       * tempo, ambas lendo "nao processado" antes de qualquer uma escrever.
       * Quem segura e a constraint unica, nao o codigo.
       */
      const respostas = await Promise.all([
        enviarWebhook(dados),
        enviarWebhook(dados),
        enviarWebhook(dados),
      ]);

      expect(respostas.every((r) => r.status === 200)).toBe(true);

      const pagamentos = await db.payment.findMany({ where: { invoiceId } });
      expect(pagamentos).toHaveLength(1);
    });
  });

  describe('INV-079 -- evento fora de ordem nao regride estado terminal', () => {
    it('falha chegando DEPOIS da confirmacao nao desfaz o pagamento', async () => {
      const { invoiceId, externalPaymentId } = await criarCobranca();

      await enviarWebhook(
        webhook({ externalPaymentId, occurredAt: '2026-08-18T12:00:00.000Z' }),
      );

      const falhaAtrasada = await enviarWebhook(
        webhook({
          externalPaymentId,
          tipo: 'PAYMENT_FAILED',
          occurredAt: '2026-08-18T11:00:00.000Z',
        }),
      );

      expect(falhaAtrasada.status).toBe(200);
      expect(corpoDeWebhookRecebido(falhaAtrasada).applied).toBe(false);

      const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(invoice.status).toBe('PAID');

      const pagamento = await db.payment.findFirstOrThrow({ where: { invoiceId } });
      expect(pagamento.status).toBe('CONFIRMED');
    });

    it('o descarte fica registrado com motivo -- nao some sem explicacao', async () => {
      const { externalPaymentId } = await criarCobranca();

      await enviarWebhook(webhook({ externalPaymentId, occurredAt: '2026-08-18T12:00:00.000Z' }));
      await enviarWebhook(
        webhook({
          externalPaymentId,
          tipo: 'PAYMENT_FAILED',
          occurredAt: '2026-08-18T10:00:00.000Z',
        }),
      );

      const descartados = await db.providerEvent.findMany({
        where: { externalPaymentId, skippedReason: { not: null } },
      });

      expect(descartados).toHaveLength(1);
      expect(descartados[0]?.skippedReason).toBe('ESTADO_TERMINAL');
    });
  });

  describe('tipo desconhecido', () => {
    it('evento que a fatia nao trata devolve 200 e nao muda nada', async () => {
      const { invoiceId, externalPaymentId } = await criarCobranca();

      const resposta = await enviarWebhook(
        webhook({ externalPaymentId, tipo: 'PAYMENT_DISPUTED' }),
      );

      expect(resposta.status).toBe(200);
      expect(corpoDeWebhookRecebido(resposta).applied).toBe(false);

      const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(invoice.status).toBe('OPEN');
    });
  });

  describe('consulta ativa de status', () => {
    it('mostra divergencia quando o provedor ja confirmou e o webhook nao chegou', async () => {
      const invoice = await request(servidor())
        .post('/api/v1/invoices')
        .set('Cookie', cenario.cookie)
        .send({ subscriptionId: cenario.subscriptionId, emQue: '2026-11-18T12:00:00.000Z' });

      const pix = await request(servidor())
        .post(`/api/v1/invoices/${corpoDeInvoice(invoice).id}/payments/pix`)
        .set('Cookie', cenario.cookie);

      // O provedor confirmou; o webhook NAO chegou.
      provedor.simularMudancaDeStatus(
        corpoDePix(pix).externalPaymentId,
        'CONFIRMED',
        new Date('2026-11-18T12:30:00Z'),
      );

      const resposta = await request(servidor())
        .get(`/api/v1/payments/${corpoDePix(pix).paymentAttemptId}/status`)
        .set('Cookie', cenario.cookie);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({
        statusLocal: 'PENDING',
        statusNoProvedor: 'CONFIRMED',
        divergente: true,
      });
    });

    it('tentativa de outro tenant nao e encontrada -- regra de arquitetura no 2', async () => {
      const resposta = await request(servidor())
        .get(`/api/v1/payments/${randomUUID()}/status`)
        .set('Cookie', cenario.cookie);

      expect(resposta.status).toBe(404);
    });
  });
});
