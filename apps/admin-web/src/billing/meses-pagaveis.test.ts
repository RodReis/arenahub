import { describe, expect, it } from 'vitest';

import {
  mesesDispensaveis,
  selecaoInicial,
  situacoesDosMeses,
  vigenteAte,
  type MesPagavelUI,
} from './meses-pagaveis';

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

  /*
   * Aluno em dia, sem fatura aberta (ex.: pagou set/26 fora do lote, out/26
   * nunca foi gerada): marca o mes "A vencer", o proximo a receber.
   */
  it('aluno em dia (so meses nao emitidos): marca o primeiro, o "A vencer"', () => {
    const emDia: MesPagavelUI[] = [
      FAIXA[3]!,
      { competencia: '2026-11', status: 'NOT_OPENED', invoiceId: null, totalMinor: 15000, dueAt: '2026-11-09' },
    ];

    expect([...selecaoInicial(emDia)]).toEqual(['2026-10']);
  });
});

describe('situacoesDosMeses', () => {
  const situacoes = (faixa: readonly MesPagavelUI[], hoje: string) =>
    situacoesDosMeses(faixa, hoje).join(',');

  it('vencido, depois o primeiro nao vencido "A vencer", o resto "Antecipar"', () => {
    expect(situacoes(FAIXA, '2026-09-20')).toBe('vencido,vencido,vencido,aVencer');
  });

  /* Caso da Iris: nov/26 OPEN vencendo em 04/11, hoje 05/10. Nao deve nada. */
  it('OPEN com vencimento no futuro e "A vencer", nunca "Em aberto"', () => {
    const iris: MesPagavelUI[] = [
      { competencia: '2026-11', status: 'OPEN', invoiceId: 'nov', totalMinor: 15000, dueAt: '2026-11-04' },
      { competencia: '2026-12', status: 'NOT_OPENED', invoiceId: null, totalMinor: 15000, dueAt: '2026-12-10' },
      { competencia: '2027-01', status: 'NOT_OPENED', invoiceId: null, totalMinor: 15000, dueAt: '2027-01-10' },
    ];

    expect(situacoes(iris, '2026-10-05')).toBe('aVencer,antecipar,antecipar');
  });

  /* Caso do Cleibio: pagou set/26, out/26 sem fatura. Nunca "Adiantado". */
  it('mes atual sem fatura e "A vencer", os seguintes "Antecipar"', () => {
    const cleibio: MesPagavelUI[] = [
      { competencia: '2026-10', status: 'NOT_OPENED', invoiceId: null, totalMinor: 15000, dueAt: '2026-10-10' },
      { competencia: '2026-11', status: 'NOT_OPENED', invoiceId: null, totalMinor: 15000, dueAt: '2026-11-10' },
    ];

    expect(situacoes(cleibio, '2026-10-05')).toBe('aVencer,antecipar');
  });

  /* Sem fatura nao ha divida ("pagou, usou") -- decisao do PI, 05/10/2026. */
  it('mes sem fatura com o dia de vencimento ja passado nunca e "Vencido"', () => {
    const semFatura: MesPagavelUI[] = [
      { competencia: '2026-10', status: 'NOT_OPENED', invoiceId: null, totalMinor: 15000, dueAt: '2026-10-10' },
    ];

    expect(situacoes(semFatura, '2026-10-15')).toBe('aVencer');
  });

  it('no dia do vencimento ainda nao venceu', () => {
    expect(situacoes([FAIXA[2]!], '2026-09-09')).toBe('aVencer');
  });

  it('sem "hoje" (antes de montar no cliente) so OVERDUE gravado e vencido', () => {
    expect(situacoes(FAIXA, '')).toBe('vencido,vencido,aVencer,antecipar');
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
