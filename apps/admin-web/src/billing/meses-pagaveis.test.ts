import { describe, expect, it } from 'vitest';

import { mesesDispensaveis, selecaoInicial, vigenteAte, type MesPagavelUI } from './meses-pagaveis';

const FAIXA: MesPagavelUI[] = [
  { competencia: '2026-07', status: 'OVERDUE', invoiceId: 'jul', totalMinor: 15000, dueAt: '2026-07-09' },
  { competencia: '2026-08', status: 'OVERDUE', invoiceId: 'ago', totalMinor: 15000, dueAt: '2026-08-09' },
  { competencia: '2026-09', status: 'OPEN', invoiceId: 'set', totalMinor: 15000, dueAt: '2026-09-09' },
  { competencia: '2026-10', status: 'NOT_OPENED', invoiceId: null, totalMinor: 15000, dueAt: '2026-10-09' },
];

describe('selecaoInicial', () => {
  it('marca so a cobranca em aberto do mes corrente, sem arrastar os vencidos', () => {
    expect([...selecaoInicial(FAIXA)]).toEqual(['2026-09']);
  });

  it('sem OPEN, marca o vencido mais recente', () => {
    expect([...selecaoInicial(FAIXA.filter((m) => m.status === 'OVERDUE'))]).toEqual(['2026-08']);
  });

  it('aluno em dia (so meses nao emitidos): nada marcado', () => {
    expect(selecaoInicial([FAIXA[3]!]).size).toBe(0);
  });
});

describe('mesesDispensaveis', () => {
  it('lista os anteriores ao ultimo selecionado, com cobranca e fora da selecao', () => {
    const dispensaveis = mesesDispensaveis(FAIXA, new Set(['2026-09']));

    expect(dispensaveis.map((m) => m.competencia)).toEqual(['2026-07', '2026-08']);
  });

  it('nao oferece mes marcado para pagar nem mes posterior ao ultimo selecionado', () => {
    const dispensaveis = mesesDispensaveis(FAIXA, new Set(['2026-08']));

    expect(dispensaveis.map((m) => m.competencia)).toEqual(['2026-07']);
  });

  it('mes sem cobranca emitida nao tem o que dispensar', () => {
    expect(mesesDispensaveis(FAIXA, new Set(['2026-10'])).map((m) => m.competencia)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
  });

  it('sem selecao, nada a dispensar', () => {
    expect(mesesDispensaveis(FAIXA, new Set())).toEqual([]);
  });
});

describe('vigenteAte', () => {
  it('um mes: data do pagamento + 30 dias', () => {
    expect(vigenteAte('2026-10-15', 1)).toBe('2026-11-14');
  });

  it('dois meses acumulam 60 dias', () => {
    expect(vigenteAte('2026-10-15', 2)).toBe('2026-12-14');
  });
});
