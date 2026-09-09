import { describe, expect, it } from '@jest/globals';

import {
  calcularFatura,
  competenciaDe,
  proximaEmissao,
  vencimentoDaFatura,
} from './calculo-da-fatura.js';

describe('calcularFatura', () => {
  const porAluno = {
    model: 'PER_STUDENT' as const,
    activeStudentPriceMinor: 500,
    inactiveStudentPriceMinor: 250,
    fixedPriceMinor: null,
  };

  it('multiplica cada contagem pelo seu preço e soma', () => {
    const fatura = calcularFatura(porAluno, { ativos: 409, inativos: 1582 });

    // 409 x 5,00 = 2.045,00 e 1.582 x 2,50 = 3.955,00 -- a base real de 08/09.
    expect(fatura.totalMinor).toBe(409 * 500 + 1582 * 250);
    expect(fatura.activeCount).toBe(409);
    expect(fatura.inactiveCount).toBe(1582);
  });

  it('com preço de inativo zero, cobra só os ativos', () => {
    const fatura = calcularFatura(
      { ...porAluno, inactiveStudentPriceMinor: 0 },
      { ativos: 10, inativos: 500 },
    );

    expect(fatura.totalMinor).toBe(10 * 500);
    // A contagem CONTINUA gravada: o tenant precisa ver quantos inativos
    // entraram no calculo mesmo quando eles nao custam nada.
    expect(fatura.inactiveCount).toBe(500);
  });

  it('no modelo fixo usa o valor corrigido e zera as contagens', () => {
    const fatura = calcularFatura(
      { model: 'FIXED_MONTHLY', activeStudentPriceMinor: null, inactiveStudentPriceMinor: null, fixedPriceMinor: 120_000 },
      { ativos: 409, inativos: 1582 },
    );

    expect(fatura.totalMinor).toBe(120_000);
    expect(fatura.activeCount).toBe(0);
    expect(fatura.inactiveCount).toBe(0);
    expect(fatura.activeStudentPriceMinor).toBeNull();
  });

  it('academia sem aluno nenhum gera fatura de zero, e não erro', () => {
    const fatura = calcularFatura(porAluno, { ativos: 0, inativos: 0 });

    expect(fatura.totalMinor).toBe(0);
  });
});

describe('competenciaDe', () => {
  it('é sempre o primeiro dia do mês, em UTC', () => {
    expect(competenciaDe(new Date('2026-03-17T22:30:00.000Z')).toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });

  /*
   * O dia 1 as 00:00 em Sao Paulo e o dia 30 as 03:00 UTC do mes ANTERIOR. Se
   * a competencia saisse do fuso local, o job da madrugada do dia 1 faturaria
   * o mes errado -- e a chave unica aceitaria as duas, porque sao meses
   * diferentes. UTC em toda a cadeia, sem excecao.
   */
  it('não escorrega para o mês anterior na virada', () => {
    expect(competenciaDe(new Date('2026-03-01T00:30:00.000Z')).toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });
});

describe('vencimentoDaFatura', () => {
  it('vence no dia de emissão da competência', () => {
    const competencia = new Date('2026-03-01T00:00:00.000Z');

    expect(vencimentoDaFatura(competencia, 10).toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });
});

describe('proximaEmissao', () => {
  it('é hoje quando hoje é o dia de emissão', () => {
    expect(proximaEmissao(new Date('2026-03-01T09:00:00.000Z'), 1).toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });

  it('é o próximo mês quando o dia já passou', () => {
    expect(proximaEmissao(new Date('2026-03-05T09:00:00.000Z'), 1).toISOString()).toBe(
      '2026-04-01T00:00:00.000Z',
    );
  });

  it('vira o ano em dezembro', () => {
    expect(proximaEmissao(new Date('2026-12-20T09:00:00.000Z'), 5).toISOString()).toBe(
      '2027-01-05T00:00:00.000Z',
    );
  });
});
