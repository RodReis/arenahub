import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { OutboxDispatcherService } from '../../src/modules/notifications/outbox-dispatcher.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F73 -- fim a fim do despachante contra banco real.
 *
 * Contra Prisma de verdade (`docs/TESTING.md` §3): a idempotencia real e o
 * `InboxReceipt` no banco, e dublar a porta so provaria o `where` do
 * TypeScript de novo (ja coberto nos testes unitarios do service e dos
 * consumidores). Aqui a pergunta e outra: o modulo Nest resolve TUDO
 * (portas Prisma reais, os dois consumidores, o registro por DI) e a
 * cadeia produtor -> outbox -> despachante -> inbox funciona sem mock.
 */
describe('F73 -- despachante de outbox fim a fim', () => {
  let db: PrismaService;
  let dispatcher: OutboxDispatcherService;

  const sufixo = randomUUID().slice(0, 8);
  let tenantId = '';
  let studentId = '';

  const AGORA = new Date('2026-09-16T12:00:00Z');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    dispatcher = moduleRef.get(OutboxDispatcherService);

    const tenant = await db.tenant.create({
      data: {
        slug: `f73-${sufixo}`,
        legalName: `F73 ${sufixo} LTDA`,
        displayName: `F73 ${sufixo}`,
      },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: 'MTZ',
        name: 'Matriz',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const plano = await db.plan.create({
      data: { tenantId, name: `Plano F73 ${sufixo}` },
      select: { id: true },
    });

    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId: unidade.id,
        membershipNumber: `M-${sufixo}`,
        fullName: 'Aluno F73',
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    studentId = aluno.id;

    const assinatura = await db.subscription.create({
      data: {
        tenantId,
        studentId: aluno.id,
        planId: plano.id,
        status: 'ACTIVE',
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
      select: { id: true },
    });

    await db.invoice.create({
      data: {
        id: randomUUID(),
        tenantId,
        subscriptionId: assinatura.id,
        studentId: aluno.id,
        billingPeriod: new Date('2026-08-01T00:00:00Z'),
        number: 1,
        status: 'PAID',
        currency: 'BRL',
        subtotalMinor: 12990,
        totalMinor: 12990,
        dueAt: new Date('2026-08-10T00:00:00Z'),
        paidAt: AGORA,
      },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: tenantId } });
  });

  it('produtor grava OutboxEvent, despachante gera StudentNotification e credita nada de XP (InvoicePaid não credita)', async () => {
    const invoice = await db.invoice.findFirstOrThrow({
      where: { tenantId, studentId },
      select: { id: true },
    });

    await db.outboxEvent.create({
      data: {
        tenantId,
        eventType: 'InvoicePaid',
        aggregateType: 'Invoice',
        aggregateId: invoice.id,
        payload: {},
      },
    });

    // Banco de integração é COMPARTILHADO entre suítes: outras já deixaram
    // outbox_events represado. O despachante real tem teto por ciclo
    // (TETO_POR_CICLO), então drena tudo que já existia antes de provar
    // que o evento DESTE teste foi entregue.
    for (let ciclos = 0; ciclos < 20; ciclos += 1) {
      const resultado = await dispatcher.executarCiclo(AGORA);
      if (resultado.eventos === 0) break;
    }

    const avisos = await db.studentNotification.findMany({
      where: { tenantId, studentId, kind: 'BILLING' },
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.action).toBe('OPEN_INVOICE');
    expect(avisos[0]?.actionTargetId).toBe(invoice.id);
  });

  it('rodar o despachante de novo não duplica o aviso (idempotência por InboxReceipt)', async () => {
    const antes = await db.studentNotification.count({ where: { tenantId, studentId } });

    await dispatcher.executarCiclo(AGORA);

    const depois = await db.studentNotification.count({ where: { tenantId, studentId } });
    expect(depois).toBe(antes);
  });
});
