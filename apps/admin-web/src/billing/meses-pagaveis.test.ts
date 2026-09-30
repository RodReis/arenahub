import { describe, expect, it } from 'vitest';

import { selecionarAte, type MesPagavelUI } from './meses-pagaveis';

const FAIXA: MesPagavelUI[] = [
  { competencia: '2026-07', status: 'OVERDUE', invoiceId: 'jul', totalMinor: 15000, dueAt: '2026-07-09' },
  { competencia: '2026-08', status: 'OVERDUE', invoiceId: 'ago', totalMinor: 15000, dueAt: '2026-08-09' },
  { competencia: '2026-09', status: 'OPEN', invoiceId: 'set', totalMinor: 15000, dueAt: '2026-09-09' },
  { competencia: '2026-10', status: 'NOT_OPENED', invoiceId: null, totalMinor: 15000, dueAt: '2026-10-09' },
];

describe('selecionarAte', () => {
  it('clicar no primeiro mes seleciona so ele', () => {
    expect(selecionarAte(FAIXA, '2026-07')).toEqual([FAIXA[0]]);
  });

  it('clicar no terceiro mes seleciona os tres primeiros, sem buraco', () => {
    expect(selecionarAte(FAIXA, '2026-09')).toEqual([FAIXA[0], FAIXA[1], FAIXA[2]]);
  });

  it('clicar no ultimo mes (adiantado) seleciona a faixa inteira', () => {
    expect(selecionarAte(FAIXA, '2026-10')).toEqual(FAIXA);
  });

  it('competencia que nao esta na faixa devolve array vazio (estado invalido, tela nao deve permitir)', () => {
    expect(selecionarAte(FAIXA, '2099-01')).toEqual([]);
  });
});
