import { describe, expect, it } from '@jest/globals';

import { avisoParaEvento } from './mapa-de-avisos.js';

describe('avisoParaEvento', () => {
  it('mapeia InvoicePaid para aviso BILLING com ação OPEN_INVOICE e sem expiração', () => {
    const agora = new Date('2026-09-16T12:00:00Z');

    const aviso = avisoParaEvento(
      { eventType: 'InvoicePaid', aggregateType: 'Invoice', aggregateId: 'invoice-1', payload: {} },
      agora,
    );

    expect(aviso).toEqual({
      kind: 'BILLING',
      title: expect.any(String),
      body: expect.any(String),
      action: 'OPEN_INVOICE',
      actionTargetId: 'invoice-1',
      expiresAt: null,
    });
  });

  it('mapeia InvoiceDueSoon para aviso BILLING que expira um dia após o vencimento', () => {
    const agora = new Date('2026-09-16T12:00:00Z');

    const aviso = avisoParaEvento(
      {
        eventType: 'InvoiceDueSoon',
        aggregateType: 'Invoice',
        aggregateId: 'invoice-2',
        payload: { dueDate: '2026-09-19T00:00:00Z' },
      },
      agora,
    );

    expect(aviso).toEqual({
      kind: 'BILLING',
      title: expect.any(String),
      body: expect.any(String),
      action: 'OPEN_INVOICE',
      actionTargetId: 'invoice-2',
      expiresAt: new Date('2026-09-20T00:00:00Z'),
    });
  });

  it('mapeia InvoiceOverdue para aviso BILLING sem expiração', () => {
    const aviso = avisoParaEvento(
      { eventType: 'InvoiceOverdue', aggregateType: 'Invoice', aggregateId: 'invoice-3', payload: {} },
      new Date('2026-09-16T12:00:00Z'),
    );

    expect(aviso).toEqual({
      kind: 'BILLING',
      title: expect.any(String),
      body: expect.any(String),
      action: 'OPEN_INVOICE',
      actionTargetId: 'invoice-3',
      expiresAt: null,
    });
  });

  it('mapeia MembershipRenewed para aviso MEMBERSHIP sem ação e sem expiração', () => {
    const aviso = avisoParaEvento(
      { eventType: 'MembershipRenewed', aggregateType: 'Membership', aggregateId: 'membership-1', payload: {} },
      new Date('2026-09-16T12:00:00Z'),
    );

    expect(aviso).toEqual({
      kind: 'MEMBERSHIP',
      title: expect.any(String),
      body: expect.any(String),
      action: 'NONE',
      actionTargetId: null,
      expiresAt: null,
    });
  });

  it('mapeia MembershipExpiringSoon para aviso MEMBERSHIP que expira um dia após o vencimento', () => {
    const aviso = avisoParaEvento(
      {
        eventType: 'MembershipExpiringSoon',
        aggregateType: 'Membership',
        aggregateId: 'membership-2',
        payload: { expiresOn: '2026-09-19T00:00:00Z' },
      },
      new Date('2026-09-16T12:00:00Z'),
    );

    expect(aviso).toEqual({
      kind: 'MEMBERSHIP',
      title: expect.any(String),
      body: expect.any(String),
      action: 'NONE',
      actionTargetId: null,
      expiresAt: new Date('2026-09-20T00:00:00Z'),
    });
  });

  it('mapeia HealthGoalReached para aviso GENERAL com ação OPEN_HEALTH', () => {
    const aviso = avisoParaEvento(
      { eventType: 'HealthGoalReached', aggregateType: 'HealthGoal', aggregateId: 'goal-1', payload: {} },
      new Date('2026-09-16T12:00:00Z'),
    );

    expect(aviso).toEqual({
      kind: 'GENERAL',
      title: expect.any(String),
      body: expect.any(String),
      action: 'OPEN_HEALTH',
      actionTargetId: 'goal-1',
      expiresAt: null,
    });
  });

  it('mapeia AssessmentPublished para aviso ASSESSMENT com ação OPEN_HEALTH', () => {
    const aviso = avisoParaEvento(
      { eventType: 'AssessmentPublished', aggregateType: 'Assessment', aggregateId: 'assessment-1', payload: {} },
      new Date('2026-09-16T12:00:00Z'),
    );

    expect(aviso).toEqual({
      kind: 'ASSESSMENT',
      title: expect.any(String),
      body: expect.any(String),
      action: 'OPEN_HEALTH',
      actionTargetId: 'assessment-1',
      expiresAt: null,
    });
  });

  it('mapeia RankingUpdated para aviso GENERAL sem ação, expira em 30 dias', () => {
    const agora = new Date('2026-09-16T12:00:00Z');

    const aviso = avisoParaEvento(
      { eventType: 'RankingUpdated', aggregateType: 'Student', aggregateId: 'student-1', payload: {} },
      agora,
    );

    expect(aviso).toEqual({
      kind: 'GENERAL',
      title: expect.any(String),
      body: expect.any(String),
      action: 'NONE',
      actionTargetId: null,
      expiresAt: new Date('2026-10-16T12:00:00Z'),
    });
  });

  it('mapeia StudentAbsent para aviso GENERAL com ação OPEN_ATTENDANCE', () => {
    const aviso = avisoParaEvento(
      { eventType: 'StudentAbsent', aggregateType: 'Student', aggregateId: 'student-2', payload: {} },
      new Date('2026-09-16T12:00:00Z'),
    );

    expect(aviso).toEqual({
      kind: 'GENERAL',
      title: expect.any(String),
      body: expect.any(String),
      action: 'OPEN_ATTENDANCE',
      actionTargetId: null,
      expiresAt: null,
    });
  });

  it('devolve null para eventType sem mapeamento (evento de outro módulo)', () => {
    const aviso = avisoParaEvento(
      { eventType: 'ReconciliationMismatchDetected', aggregateType: 'Reconciliation', aggregateId: 'x', payload: {} },
      new Date('2026-09-16T12:00:00Z'),
    );

    expect(aviso).toBeNull();
  });
});
