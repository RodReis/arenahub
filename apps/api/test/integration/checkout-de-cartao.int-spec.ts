import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
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
