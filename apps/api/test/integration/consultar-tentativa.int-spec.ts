import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { ConsultarTentativaUseCase } from '../../src/modules/billing/consultar-tentativa.use-case.js';
import {
  FakePaymentProvider,
  PROVEDOR_FAKE,
} from '../../src/modules/billing/provider/fake-payment-provider.adapter.js';
import { PAYMENT_PROVIDER } from '../../src/modules/billing/provider/payment-provider.port.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F53 -- task 5: leitura barata para o laco de polling do balcao.
 *
 * NAO TOCA NO PROVEDOR. E a razao de esta rota existir: o laco da tela roda
 * a cada 3s, e a rota que ja existia (`/payments/:id/status`) consulta o
 * provedor toda vez. Se este teste falhar porque `fake.chamadasDeStatus`
 * subiu, o polling virou chamada externa em laco -- e o fake nao tem rate
 * limit para avisar.
 */
describe('GET /payment-attempts/:id', () => {
  let db: PrismaService;
  let useCase: ConsultarTentativaUseCase;
  let fake: FakePaymentProvider;
  let senhas: PasswordService;

  const sufixo = randomUUID().slice(0, 8);
  const CONTA_EXTERNA = `ACC-F53-${sufixo}`;

  const contexto: TenantContext = {
    tenantId: '',
    // `audit_logs.actor_id` tem FK para `users` -- UUID solto quebra a
    // constraint. Usuario real evita a armadilha ja conhecida do modulo.
    actorId: '',
    sessionId: randomUUID(),
    permissions: new Set(['billing.read']),
    allowedUnitIds: 'ALL',
  };

  const outroContexto: TenantContext = {
    tenantId: '',
    actorId: '',
    sessionId: randomUUID(),
    permissions: new Set(['billing.read']),
    allowedUnitIds: 'ALL',
  };

  let studentId = '';
  let subscriptionId = '';
  let periodo = 0;

  function competenciaUnica(indice: number): Date {
    const ano = 2026 + Math.floor(indice / 12);
    const mes = (indice % 12) + 1;

    return new Date(`${ano}-${String(mes).padStart(2, '0')}-01T00:00:00Z`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    senhas = moduleRef.get(PasswordService);
    useCase = moduleRef.get(ConsultarTentativaUseCase);
    fake = moduleRef.get(PAYMENT_PROVIDER);

    const tenant = await db.tenant.create({
      data: {
        slug: `f53-tentativa-${sufixo}`,
        legalName: `F53 Tentativa ${sufixo} LTDA`,
        displayName: `F53 Tentativa ${sufixo}`,
      },
    });
    contexto.tenantId = tenant.id;

    const operador = await db.user.create({
      data: {
        email: `f53-op-${sufixo}@exemplo.test`,
        passwordHash: await senhas.gerarHash('f53-senha-de-teste-nao-usada-em-producao'),
      },
      select: { id: true },
    });
    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: operador.id } });
    contexto.actorId = operador.id;

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
    fake.registrarConta(CONTA_EXTERNA, 'segredo-de-teste');

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
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
      select: { id: true },
    });
    subscriptionId = assinatura.id;

    // Tenant vizinho -- prova o isolamento (404, nunca 409).
    const outroTenant = await db.tenant.create({
      data: {
        slug: `f53-outro-${sufixo}`,
        legalName: `F53 Outro ${sufixo} LTDA`,
        displayName: `F53 Outro ${sufixo}`,
      },
    });
    outroContexto.tenantId = outroTenant.id;
    outroContexto.actorId = operador.id;
    void conta;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [contexto.tenantId, outroContexto.tenantId] } } });
  });

  /** Abre invoice + tentativa PIX em PROCESSING, sem pagamento confirmado. */
  async function criarTentativaPix(
    tenantId: string,
  ): Promise<{ id: string; invoiceId: string }> {
    periodo += 1;

    const invoice = await db.invoice.create({
      data: {
        tenantId,
        subscriptionId,
        studentId,
        billingPeriod: competenciaUnica(periodo),
        number: periodo,
        status: 'OPEN',
        currency: 'BRL',
        subtotalMinor: 12_000,
        totalMinor: 12_000,
        dueAt: new Date('2026-09-10T12:00:00.000Z'),
      },
      select: { id: true },
    });

    const tentativa = await db.paymentAttempt.create({
      data: {
        tenantId,
        invoiceId: invoice.id,
        method: 'PIX',
        status: 'PROCESSING',
        idempotencyKey: `pix:${sufixo}:${periodo}`,
        providerAccountId: CONTA_EXTERNA,
        externalPaymentId: `ext_${sufixo}_${periodo}`,
      },
      select: { id: true },
    });

    return { id: tentativa.id, invoiceId: invoice.id };
  }

  /** Tentativa paga, com `Payment` confirmado e recibo ja emitido. */
  async function criarTentativaPagaComRecibo(): Promise<{
    tentativaId: string;
    receiptId: string;
  }> {
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
        dueAt: new Date('2026-09-10T12:00:00.000Z'),
        paidAt: new Date('2026-09-05T12:00:00.000Z'),
      },
      select: { id: true },
    });

    const tentativa = await db.paymentAttempt.create({
      data: {
        tenantId: contexto.tenantId,
        invoiceId: invoice.id,
        method: 'PIX',
        status: 'SUCCEEDED',
        idempotencyKey: `pix:${sufixo}:${periodo}`,
        providerAccountId: CONTA_EXTERNA,
        externalPaymentId: `ext_${sufixo}_${periodo}`,
        settledAt: new Date('2026-09-05T12:00:00.000Z'),
      },
      select: { id: true },
    });

    const pagamento = await db.payment.create({
      data: {
        tenantId: contexto.tenantId,
        invoiceId: invoice.id,
        attemptId: tentativa.id,
        amountMinor: 12_000,
        currency: 'BRL',
        method: 'PIX',
        status: 'CONFIRMED',
        paidAt: new Date('2026-09-05T12:00:00.000Z'),
        providerAccountId: CONTA_EXTERNA,
        externalPaymentId: `ext_${sufixo}_${periodo}`,
      },
      select: { id: true },
    });

    const recibo = await db.receipt.create({
      data: {
        tenantId: contexto.tenantId,
        paymentId: pagamento.id,
        invoiceId: invoice.id,
        number: periodo,
        snapshot: { tipo: 'RECIBO_NAO_FISCAL' },
        verificationHash: `hash-${sufixo}-${periodo}`,
      },
      select: { id: true },
    });

    return { tentativaId: tentativa.id, receiptId: recibo.id };
  }

  it('le do banco sem consultar o provedor', async () => {
    const chamadasAntes = fake.chamadasDeStatus;
    const tentativa = await criarTentativaPix(contexto.tenantId);

    const observada = await useCase.executar(contexto, tentativa.id);

    expect(observada.status).toBe('PROCESSING');
    expect(fake.chamadasDeStatus).toBe(chamadasAntes);
  });

  it('devolve o recibo quando ja foi emitido', async () => {
    const { tentativaId, receiptId } = await criarTentativaPagaComRecibo();

    const observada = await useCase.executar(contexto, tentativaId);

    expect(observada.invoiceStatus).toBe('PAID');
    expect(observada.receiptId).toBe(receiptId);
  });

  it('tentativa de outro tenant e 404', async () => {
    const doOutro = await criarTentativaPix(outroContexto.tenantId);

    await expect(useCase.executar(contexto, doOutro.id)).rejects.toMatchObject({
      code: 'PAYMENT_ATTEMPT_NOT_FOUND',
      status: 404,
    });
  });
});
