import { describe, expect, it } from '@jest/globals';

import { NotificationsInboxConsumer } from './notifications-inbox.consumer.js';
import { FakePortaDeAvisos } from './notifications-inbox.repository.fake.js';

const AGORA = new Date('2026-09-16T12:00:00Z');

describe('NotificationsInboxConsumer', () => {
  it('trata eventos que o mapa de avisos reconhece', () => {
    const consumer = new NotificationsInboxConsumer(new FakePortaDeAvisos());

    expect(consumer.trata('InvoicePaid')).toBe(true);
    expect(consumer.trata('ReconciliationMismatchDetected')).toBe(false);
  });

  it('resolve o studentId pelo agregado (Invoice) e grava o aviso', async () => {
    const porta = new FakePortaDeAvisos();
    porta.comAgregado('Invoice', 'invoice-1', 'student-1');
    const consumer = new NotificationsInboxConsumer(porta);

    await consumer.processar({
      id: 'e1',
      tenantId: 't1',
      eventType: 'InvoicePaid',
      aggregateType: 'Invoice',
      aggregateId: 'invoice-1',
      payload: {},
    }, AGORA);

    expect(porta.gravados).toEqual([
      {
        tenantId: 't1',
        studentId: 'student-1',
        kind: 'BILLING',
        title: expect.any(String),
        body: expect.any(String),
        action: 'OPEN_INVOICE',
        actionTargetId: 'invoice-1',
        expiresAt: null,
      },
    ]);
  });

  it('usa o proprio aggregateId como studentId quando o agregado JA E o aluno', async () => {
    const porta = new FakePortaDeAvisos();
    const consumer = new NotificationsInboxConsumer(porta);

    await consumer.processar({
      id: 'e2',
      tenantId: 't1',
      eventType: 'StudentAbsent',
      aggregateType: 'Student',
      aggregateId: 'student-2',
      payload: {},
    }, AGORA);

    expect(porta.gravados[0]?.studentId).toBe('student-2');
  });

  it('nao grava nada quando o evento nao tem mapeamento', async () => {
    const porta = new FakePortaDeAvisos();
    const consumer = new NotificationsInboxConsumer(porta);

    await consumer.processar({
      id: 'e3',
      tenantId: 't1',
      eventType: 'ReconciliationMismatchDetected',
      aggregateType: 'Reconciliation',
      aggregateId: 'x',
      payload: {},
    }, AGORA);

    expect(porta.gravados).toEqual([]);
  });

  it('nao grava quando o agregado nao resolve para nenhum aluno (registro orfao)', async () => {
    const porta = new FakePortaDeAvisos();
    const consumer = new NotificationsInboxConsumer(porta);

    await consumer.processar({
      id: 'e4',
      tenantId: 't1',
      eventType: 'InvoicePaid',
      aggregateType: 'Invoice',
      aggregateId: 'invoice-inexistente',
      payload: {},
    }, AGORA);

    expect(porta.gravados).toEqual([]);
  });
});
