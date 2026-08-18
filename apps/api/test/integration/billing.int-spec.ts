import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { BillingRepository } from '../../src/modules/billing/billing.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F12 -- ledger operacional e invoice (Slice 2.1).
 *
 * O que SO integracao prova, e por isso este arquivo existe alem dos
 * unitarios de dominio:
 *
 *   - a constraint de INV-066 existe DE FATO no banco: abrir a invoice do
 *     mesmo periodo duas vezes devolve a MESMA linha, sem gastar numero;
 *   - a numeracao por tenant nao vaza entre tenants (o tenant B comeca do 1
 *     mesmo com o A ja tendo emitido);
 *   - o evento de outbox e escrito na MESMA transacao (INV-084);
 *   - sobrepagamento gera credito com origem rastreavel;
 *   - pagamento parcial e recusado (ADR-027, resposta 1 do PI).
 */
describe('F12 -- invoice e pagamento manual', () => {
  let app: INestApplication;
  let db: PrismaService;
  let billing: BillingRepository;

  const sufixo = randomUUID().slice(0, 8);

  const a = { tenantId: '', studentId: '', planId: '', subscriptionId: '', actorId: '' };
  const b = { tenantId: '', studentId: '', planId: '', subscriptionId: '', actorId: '' };

  const COMPETENCIA = new Date('2026-08-18T12:00:00Z');
  const PRECO_MINOR = 15_000;

  function contexto(tenantId: string, actorId: string): TenantContext {
    return {
      tenantId,
      actorId,
      sessionId: randomUUID(),
      permissions: new Set(['billing.manage']),
      allowedUnitIds: 'ALL',
    };
  }

  /** Cria tenant, aluno, plano com preco vigente, assinatura e config. */
  async function semearTenant(rotulo: string): Promise<{
    tenantId: string;
    studentId: string;
    planId: string;
    subscriptionId: string;
    actorId: string;
  }> {
    const tenant = await db.tenant.create({
      data: {
        slug: `t-${rotulo}-${sufixo}`,
        legalName: `Tenant ${rotulo} ${sufixo} LTDA`,
        displayName: `Tenant ${rotulo} ${sufixo}`,
      },
    });

    // A F45 tornou `students.gym_unit_id` obrigatorio: todo aluno nasce numa
    // unidade de origem. Cobranca nao consulta unidade -- ela existe aqui so
    // para o aluno da fixture ser valido.
    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: `UNI-${rotulo}-${sufixo}`,
        name: 'Unidade da fixture',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    // `audit_logs.actor_id` tem FK para `users`: o operador precisa
    // EXISTIR. Descobri isso pelo teste -- com UUID solto, o registro de
    // pagamento manual quebrava na auditoria, que e justamente a mitigacao
    // detectiva do ADR-027.
    const operador = await db.user.create({
      data: { email: `op-${rotulo}-${sufixo}@arena.test`, passwordHash: 'x'.repeat(60) },
    });

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Plano ${rotulo} ${sufixo}` },
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
        fullName: `Aluno ${rotulo}`,
        membershipNumber: `${rotulo}-${sufixo}`,
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
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
    });

    await db.billingSettings.create({
      data: { tenantId: tenant.id, dueDay: 10, graceDays: 5 },
    });

    return {
      tenantId: tenant.id,
      studentId: aluno.id,
      planId: plano.id,
      subscriptionId: assinatura.id,
      actorId: operador.id,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    billing = app.get(BillingRepository);

    Object.assign(a, await semearTenant('a'));
    Object.assign(b, await semearTenant('b'));
  });

  afterAll(async () => {
    // Cascade limpa invoice, item, pagamento, credito e sequencia.
    await db.tenant.deleteMany({ where: { id: { in: [a.tenantId, b.tenantId] } } });
    await db.user.deleteMany({ where: { id: { in: [a.actorId, b.actorId] } } });
    await app.close();
  });

  it('abre a invoice do periodo com o preco vigente copiado', async () => {
    const invoice = await billing.abrirInvoiceDoPeriodo(contexto(a.tenantId, a.actorId), {
      subscriptionId: a.subscriptionId,
      emQue: COMPETENCIA,
    });

    expect(invoice.status).toBe('OPEN');
    expect(invoice.totalMinor).toBe(PRECO_MINOR);
    expect(invoice.number).toBe(1);
    // Competencia normalizada para o primeiro dia -- e o que da a unicidade.
    expect(invoice.billingPeriod.toISOString()).toContain('2026-08-01');
    // dueDay 10 + graceDays 5.
    expect(invoice.dueAt.toISOString()).toContain('2026-08-10');
    expect(invoice.blockAt?.toISOString()).toContain('2026-08-15');
  });

  it('abrir de novo o MESMO periodo devolve a mesma invoice, sem gastar numero', async () => {
    const primeira = await billing.abrirInvoiceDoPeriodo(contexto(a.tenantId, a.actorId), {
      subscriptionId: a.subscriptionId,
      emQue: COMPETENCIA,
    });

    // Outro dia do mesmo mes: a competencia normaliza para o mesmo periodo.
    const segunda = await billing.abrirInvoiceDoPeriodo(contexto(a.tenantId, a.actorId), {
      subscriptionId: a.subscriptionId,
      emQue: new Date('2026-08-27T23:00:00Z'),
    });

    expect(segunda.id).toBe(primeira.id);
    expect(segunda.number).toBe(primeira.number);

    const quantas = await db.invoice.count({
      where: { tenantId: a.tenantId, subscriptionId: a.subscriptionId },
    });
    expect(quantas).toBe(1);
  });

  it('a numeracao NAO vaza entre tenants -- o tenant B comeca do 1', async () => {
    const doB = await billing.abrirInvoiceDoPeriodo(contexto(b.tenantId, b.actorId), {
      subscriptionId: b.subscriptionId,
      emQue: COMPETENCIA,
    });

    expect(doB.number).toBe(1);
  });

  it('escreve o evento de outbox na mesma transacao (INV-084)', async () => {
    const eventos = await db.outboxEvent.findMany({
      where: { tenantId: a.tenantId, eventType: 'InvoiceOpened' },
    });

    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.aggregateType).toBe('Invoice');
  });

  it('recusa pagamento parcial -- nao existe saldo devedor no MVP 2', async () => {
    const invoice = await billing.abrirInvoiceDoPeriodo(contexto(a.tenantId, a.actorId), {
      subscriptionId: a.subscriptionId,
      emQue: COMPETENCIA,
    });

    await expect(
      billing.registrarPagamentoManual(
        contexto(a.tenantId, a.actorId),
        {
          invoiceId: invoice.id,
          amountMinor: PRECO_MINOR - 100,
          reason: 'tentativa parcial',
          paidAt: new Date('2026-08-09T10:00:00Z'),
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });

  it('sobrepagamento paga a invoice e gera credito com origem rastreavel', async () => {
    const invoice = await billing.abrirInvoiceDoPeriodo(contexto(b.tenantId, b.actorId), {
      subscriptionId: b.subscriptionId,
      emQue: COMPETENCIA,
    });

    const ctx = contexto(b.tenantId, b.actorId);
    const pagamento = await billing.registrarPagamentoManual(
      ctx,
      {
        invoiceId: invoice.id,
        amountMinor: PRECO_MINOR + 100,
        reason: 'pagou com nota maior',
        paidAt: new Date('2026-08-09T10:00:00Z'),
      },
      randomUUID(),
    );

    expect(pagamento.method).toBe('MANUAL');
    expect(pagamento.status).toBe('CONFIRMED');
    // A mitigacao detectiva do ADR-027: o dinheiro manual fica ligado a
    // uma pessoa.
    expect(pagamento.recognizedByUserId).toBe(ctx.actorId);

    const paga = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(paga.status).toBe('PAID');

    const creditos = await db.accountCredit.findMany({ where: { tenantId: b.tenantId } });
    expect(creditos).toHaveLength(1);
    expect(creditos[0]?.amountMinor).toBe(100);
    expect(creditos[0]?.originPaymentId).toBe(pagamento.id);
  });

  it('invoice paga NAO aceita segundo pagamento -- PAID e terminal (INV-069)', async () => {
    const invoice = await db.invoice.findFirstOrThrow({
      where: { tenantId: b.tenantId, status: 'PAID' },
    });

    await expect(
      billing.registrarPagamentoManual(
        contexto(b.tenantId, b.actorId),
        {
          invoiceId: invoice.id,
          amountMinor: PRECO_MINOR,
          reason: 'pagamento duplicado',
          paidAt: new Date('2026-08-11T10:00:00Z'),
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });

  it('tenant A nao enxerga invoice do tenant B', async () => {
    const doB = await db.invoice.findFirstOrThrow({ where: { tenantId: b.tenantId } });

    await expect(
      billing.registrarPagamentoManual(
        contexto(a.tenantId, a.actorId),
        {
          invoiceId: doB.id,
          amountMinor: PRECO_MINOR,
          reason: 'cross-tenant',
          paidAt: new Date('2026-08-09T10:00:00Z'),
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
});
