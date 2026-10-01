import { describe, expect, it } from '@jest/globals';

import {
  DataDePagamentoFuturaError,
  instanteDoPagamento,
  LoteInvalidoError,
  mesesPagaveis,
  resolverDispensa,
  resolverLote,
  vencimentoAposPagamento,
  type InvoiceParaFaixa,
} from './meses-pagaveis.js';

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

describe('mesesPagaveis -- mes ja resolvido nao reaparece', () => {
  it('mes com invoice PAID sai da faixa (nao fica como Adiantado para pagar de novo)', () => {
    const faixa = mesesPagaveis({
      invoices: [invoice({ id: 'out', billingPeriod: new Date('2026-10-01T00:00:00Z'), status: 'PAID' })],
      agora: new Date('2026-10-01T15:00:00Z'),
      endsAt: null,
      prices: PRECO_150,
      dueDay: 9,
    });

    expect(faixa.map((m) => m.competencia.toISOString().slice(0, 7))).not.toContain('2026-10');
    expect(faixa[0]!.competencia).toEqual(new Date('2026-11-01T00:00:00Z'));
  });

  it('mes CANCELLED (dispensado) tambem sai da faixa', () => {
    const faixa = mesesPagaveis({
      invoices: [
        invoice({ id: 'set', billingPeriod: new Date('2026-09-01T00:00:00Z'), status: 'CANCELLED' }),
        invoice({ id: 'out', billingPeriod: new Date('2026-10-01T00:00:00Z'), status: 'OPEN' }),
      ],
      agora: new Date('2026-10-01T15:00:00Z'),
      endsAt: null,
      prices: PRECO_150,
      dueDay: 9,
    });

    expect(faixa.map((m) => m.competencia.toISOString().slice(0, 7))).not.toContain('2026-09');
    expect(faixa[0]!.invoiceId).toBe('out');
  });

  it('pagar mes que ja esta pago e recusado pelo lote', () => {
    const faixa = mesesPagaveis({
      invoices: [invoice({ id: 'out', billingPeriod: new Date('2026-10-01T00:00:00Z'), status: 'PAID' })],
      agora: new Date('2026-10-01T15:00:00Z'),
      endsAt: null,
      prices: PRECO_150,
      dueDay: 9,
    });

    expect(() => resolverLote(faixa, [new Date('2026-10-01T00:00:00Z')])).toThrow(LoteInvalidoError);
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
  const mes = (iso: string) => new Date(`${iso}-01T00:00:00Z`);

  it('escolha livre: pagar so setembro NAO obriga julho nem agosto', () => {
    const lote = resolverLote(faixaBase, [mes('2026-09')]);

    expect(lote.map((m) => m.competencia.toISOString().slice(0, 7))).toEqual(['2026-09']);
  });

  it('escolha livre com buraco: jul e out, sem ago e set, e devolvido em ordem cronologica', () => {
    const lote = resolverLote(faixaBase, [mes('2026-10'), mes('2026-07')]);

    expect(lote.map((m) => m.competencia.toISOString().slice(0, 7))).toEqual(['2026-07', '2026-10']);
  });

  it('competencia fora da faixa (alem do teto) lanca LoteInvalidoError', () => {
    expect(() => resolverLote(faixaBase, [mes('2028-01')])).toThrow(LoteInvalidoError);
  });

  it('competencia anterior ao primeiro mes da faixa lanca LoteInvalidoError', () => {
    expect(() => resolverLote(faixaBase, [mes('2026-06')])).toThrow(LoteInvalidoError);
  });

  it('selecao vazia lanca LoteInvalidoError', () => {
    expect(() => resolverLote(faixaBase, [])).toThrow(LoteInvalidoError);
  });

  it('mes repetido na selecao lanca LoteInvalidoError', () => {
    expect(() => resolverLote(faixaBase, [mes('2026-09'), mes('2026-09')])).toThrow(LoteInvalidoError);
  });
});

describe('resolverDispensa', () => {
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
  const mes = (iso: string) => new Date(`${iso}-01T00:00:00Z`);
  const pagas = resolverLote(faixaBase, [mes('2026-09')]);

  it('dispensa mes anterior em aberto que a recepcao marcou', () => {
    const dispensadas = resolverDispensa(faixaBase, pagas, [mes('2026-07')]);

    expect(dispensadas.map((m) => m.invoiceId)).toEqual(['jul']);
  });

  it('nao dispensa mes que esta sendo pago no mesmo lote', () => {
    expect(() => resolverDispensa(faixaBase, pagas, [mes('2026-09')])).toThrow(LoteInvalidoError);
  });

  it('nao dispensa mes POSTERIOR ao ultimo pago (isso seria perdoar cobranca futura)', () => {
    expect(() => resolverDispensa(faixaBase, pagas, [mes('2026-10')])).toThrow(LoteInvalidoError);
  });

  it('mes que nao esta na faixa lanca LoteInvalidoError', () => {
    expect(() => resolverDispensa(faixaBase, pagas, [mes('2026-05')])).toThrow(LoteInvalidoError);
  });

  it('mes sem invoice (NOT_OPENED) anterior ao pago nao tem o que dispensar: ignorado', () => {
    const faixaSemAtraso = mesesPagaveis({ invoices: [], agora: new Date('2026-09-15T00:00:00Z'), endsAt: null, prices: PRECO_150, dueDay: 9 });
    const paga = resolverLote(faixaSemAtraso, [mes('2026-10')]);

    expect(resolverDispensa(faixaSemAtraso, paga, [mes('2026-09')])).toEqual([]);
  });
});

describe('instanteDoPagamento', () => {
  const AGORA = new Date('2026-10-01T15:30:00Z');
  const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it('hoje: usa o instante real', () => {
    expect(instanteDoPagamento(dia('2026-10-01'), AGORA)).toEqual(AGORA);
  });

  it('dia passado: meio-dia UTC, que cai no mesmo dia no Brasil', () => {
    expect(instanteDoPagamento(dia('2026-09-20'), AGORA)).toEqual(new Date('2026-09-20T12:00:00Z'));
  });

  it('dia futuro lanca DataDePagamentoFuturaError', () => {
    expect(() => instanteDoPagamento(dia('2026-10-02'), AGORA)).toThrow(DataDePagamentoFuturaError);
  });
});

describe('vencimentoAposPagamento', () => {
  const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it('um mes: data do pagamento + 30 dias', () => {
    expect(vencimentoAposPagamento(dia('2026-10-15'), 1)).toEqual(dia('2026-11-14'));
  });

  it('varios meses acumulam 30 dias cada', () => {
    expect(vencimentoAposPagamento(dia('2026-10-15'), 2)).toEqual(dia('2026-12-14'));
  });
});
