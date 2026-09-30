import { describe, expect, it } from '@jest/globals';

import { LoteInvalidoError, mesesPagaveis, resolverLote, type InvoiceParaFaixa } from './meses-pagaveis.js';

const PRECO_150 = [{ amountMinor: 15000, currency: 'BRL', validFrom: new Date('2020-01-01T00:00:00Z') }];

function invoice(overrides: Partial<InvoiceParaFaixa>): InvoiceParaFaixa {
  return {
    id: 'inv-1',
    billingPeriod: new Date('2026-09-01T00:00:00Z'),
    status: 'OPEN',
    totalMinor: 15000,
    dueAt: new Date('2026-09-09T00:00:00Z'),
    ...overrides,
  };
}

describe('mesesPagaveis', () => {
  it('aluno em dia: comeca no mes corrente, sem invoice aberta', () => {
    const faixa = mesesPagaveis({
      invoices: [],
      agora: new Date('2026-09-15T00:00:00Z'),
      endsAt: null,
      prices: PRECO_150,
      dueDay: 9,
    });

    expect(faixa[0]).toEqual({
      competencia: new Date('2026-09-01T00:00:00Z'),
      status: 'NOT_OPENED',
      invoiceId: null,
      totalMinor: 15000,
      dueAt: new Date('2026-09-09T00:00:00Z'),
    });
    // corrente + 6 = 7 meses no total
    expect(faixa).toHaveLength(7);
    expect(faixa[6]!.competencia).toEqual(new Date('2027-03-01T00:00:00Z'));
  });

  it('2 meses vencidos: comeca no mais antigo em aberto, nao no corrente', () => {
    const faixa = mesesPagaveis({
      invoices: [
        invoice({ id: 'jul', billingPeriod: new Date('2026-07-01T00:00:00Z'), status: 'OVERDUE' }),
        invoice({ id: 'ago', billingPeriod: new Date('2026-08-01T00:00:00Z'), status: 'OVERDUE' }),
      ],
      agora: new Date('2026-09-15T00:00:00Z'),
      endsAt: null,
      prices: PRECO_150,
      dueDay: 9,
    });

    expect(faixa[0]!.competencia).toEqual(new Date('2026-07-01T00:00:00Z'));
    expect(faixa[0]!.status).toBe('OVERDUE');
    expect(faixa[0]!.invoiceId).toBe('jul');
    expect(faixa[1]!.status).toBe('OVERDUE');
    expect(faixa[2]!.competencia).toEqual(new Date('2026-09-01T00:00:00Z'));
    expect(faixa[2]!.status).toBe('NOT_OPENED');
  });

  it('invoices PAID e CANCELLED nao aparecem na faixa', () => {
    const faixa = mesesPagaveis({
      invoices: [
        invoice({ id: 'jul', billingPeriod: new Date('2026-07-01T00:00:00Z'), status: 'PAID' }),
        invoice({ id: 'ago', billingPeriod: new Date('2026-08-01T00:00:00Z'), status: 'OVERDUE' }),
      ],
      agora: new Date('2026-09-15T00:00:00Z'),
      endsAt: null,
      prices: PRECO_150,
      dueDay: 9,
    });

    expect(faixa[0]!.competencia).toEqual(new Date('2026-08-01T00:00:00Z'));
    expect(faixa.find((m) => m.invoiceId === 'jul')).toBeUndefined();
  });

  it('endsAt corta a faixa antes do teto de 6 meses', () => {
    const faixa = mesesPagaveis({
      invoices: [],
      agora: new Date('2026-09-15T00:00:00Z'),
      endsAt: new Date('2026-11-01T00:00:00Z'), // assinatura acaba no comeco de novembro
      prices: PRECO_150,
      dueDay: 9,
    });

    // set e out cabem (competencia < endsAt); nov nao cabe
    expect(faixa.map((m) => m.competencia.getUTCMonth())).toEqual([8, 9]); // set(8), out(9)
  });

  it('troca de preco no meio da faixa: cada NOT_OPENED usa o preco vigente da sua propria competencia', () => {
    const precos = [
      { amountMinor: 15000, currency: 'BRL', validFrom: new Date('2020-01-01T00:00:00Z') },
      { amountMinor: 18000, currency: 'BRL', validFrom: new Date('2026-10-01T00:00:00Z') },
    ];

    const faixa = mesesPagaveis({
      invoices: [],
      agora: new Date('2026-09-15T00:00:00Z'),
      endsAt: null,
      prices: precos,
      dueDay: 9,
    });

    const setembro = faixa.find((m) => m.competencia.getTime() === new Date('2026-09-01T00:00:00Z').getTime())!;
    const outubro = faixa.find((m) => m.competencia.getTime() === new Date('2026-10-01T00:00:00Z').getTime())!;
    expect(setembro.totalMinor).toBe(15000);
    expect(outubro.totalMinor).toBe(18000);
  });

  it('virada de ano: dezembro para janeiro incrementa o ano corretamente', () => {
    const faixa = mesesPagaveis({
      invoices: [],
      agora: new Date('2026-11-15T00:00:00Z'),
      endsAt: null,
      prices: PRECO_150,
      dueDay: 9,
    });

    const competencias = faixa.map((m) => m.competencia.toISOString().slice(0, 7));
    expect(competencias).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05']);
  });
});

describe('resolverLote', () => {
  const faixaBase = mesesPagaveis({
    invoices: [
      invoice({ id: 'jul', billingPeriod: new Date('2026-07-01T00:00:00Z'), status: 'OVERDUE' }),
      invoice({ id: 'ago', billingPeriod: new Date('2026-08-01T00:00:00Z'), status: 'OVERDUE' }),
    ],
    agora: new Date('2026-09-15T00:00:00Z'),
    endsAt: null,
    prices: PRECO_150,
    dueDay: 9,
  });

  it('ateCompetencia = jul devolve so o primeiro mes', () => {
    const lote = resolverLote(faixaBase, new Date('2026-07-01T00:00:00Z'));
    expect(lote).toHaveLength(1);
    expect(lote[0]!.invoiceId).toBe('jul');
  });

  it('ateCompetencia cobrindo vencidos + adiantados devolve todos os meses ate la, sem buraco', () => {
    const lote = resolverLote(faixaBase, new Date('2026-11-01T00:00:00Z'));
    // jul, ago, set, out, nov = 5 meses
    expect(lote).toHaveLength(5);
    expect(lote.map((m) => m.competencia.getUTCMonth())).toEqual([6, 7, 8, 9, 10]);
  });

  it('ateCompetencia fora da faixa (alem do teto) lanca LoteInvalidoError', () => {
    expect(() => resolverLote(faixaBase, new Date('2028-01-01T00:00:00Z'))).toThrow(LoteInvalidoError);
  });

  it('ateCompetencia antes do primeiro mes da faixa lanca LoteInvalidoError (nao ha como excluir o mais antigo)', () => {
    expect(() => resolverLote(faixaBase, new Date('2026-06-01T00:00:00Z'))).toThrow(LoteInvalidoError);
  });
});
