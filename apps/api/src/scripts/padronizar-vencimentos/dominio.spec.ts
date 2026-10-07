import { describe, expect, it } from '@jest/globals';

import { coberturasDosPagos, planejarFaturaAberta } from './dominio.js';

const SP = 'America/Sao_Paulo';
const cfg = { dueDay: 10, graceDays: 5, fuso: SP };
const d = (iso: string): Date => new Date(iso);

describe('planejarFaturaAberta', () => {
  it('fatura ancorada (nov em 06/11) volta para 10/11 e bloqueio 15/11 local', () => {
    expect(
      planejarFaturaAberta(
        { billingPeriod: d('2026-11-01T00:00:00Z'), status: 'OPEN', dueAt: d('2026-11-06T00:00:00Z'), blockAt: d('2026-11-09T00:00:00Z') },
        cfg,
        d('2026-10-07T15:00:00Z'),
      ),
    ).toEqual({ dueAt: d('2026-11-10T00:00:00Z'), blockAt: d('2026-11-15T03:00:00Z'), status: 'OPEN' });
  });

  it('OVERDUE cujo novo bloqueio e futuro volta a OPEN', () => {
    expect(
      planejarFaturaAberta(
        { billingPeriod: d('2026-10-01T00:00:00Z'), status: 'OVERDUE', dueAt: d('2026-10-09T00:00:00Z'), blockAt: d('2026-10-12T00:00:00Z') },
        cfg,
        d('2026-10-13T15:00:00Z'),
      )?.status,
    ).toBe('OPEN');
  });

  it('OVERDUE de set/26 continua OVERDUE (15/09 ja passou)', () => {
    expect(
      planejarFaturaAberta(
        { billingPeriod: d('2026-09-01T00:00:00Z'), status: 'OVERDUE', dueAt: d('2026-09-10T00:00:00Z'), blockAt: null },
        cfg,
        d('2026-10-07T15:00:00Z'),
      ),
    ).toEqual({ dueAt: d('2026-09-10T00:00:00Z'), blockAt: d('2026-09-15T03:00:00Z'), status: 'OVERDUE' });
  });

  it('ja padronizada devolve null (idempotente)', () => {
    expect(
      planejarFaturaAberta(
        { billingPeriod: d('2026-10-01T00:00:00Z'), status: 'OPEN', dueAt: d('2026-10-10T00:00:00Z'), blockAt: d('2026-10-15T03:00:00Z') },
        cfg,
        d('2026-10-07T15:00:00Z'),
      ),
    ).toBeNull();
  });
});

describe('coberturasDosPagos', () => {
  it('lote escalonado por competencia; avulso k=1; ignora quem ja tem cobertura', () => {
    const r = coberturasDosPagos([
      { invoiceId: 'dez', billingPeriod: d('2026-12-01T00:00:00Z'), paidAt: d('2026-10-07T12:00:00Z'), batchId: 'L' },
      { invoiceId: 'out', billingPeriod: d('2026-10-01T00:00:00Z'), paidAt: d('2026-10-07T12:00:00Z'), batchId: 'L' },
      { invoiceId: 'nov', billingPeriod: d('2026-11-01T00:00:00Z'), paidAt: d('2026-10-07T12:00:00Z'), batchId: 'L' },
      { invoiceId: 'set', billingPeriod: d('2026-09-01T00:00:00Z'), paidAt: d('2026-09-05T18:00:00Z'), batchId: null },
    ]);

    expect(Object.fromEntries([...r].map(([id, data]) => [id, data.toISOString().slice(0, 10)]))).toEqual({
      out: '2026-11-06',
      nov: '2026-12-06',
      dez: '2027-01-05',
      set: '2026-10-05',
    });
  });
});
