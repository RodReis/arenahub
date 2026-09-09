import { describe, expect, it } from '@jest/globals';

import {
  aniversariosVencidos,
  corrigirPorIndice,
  competenciasDaJanela,
  type ValorDeIndice,
} from './correcao-por-indice.js';

/** Atalho de leitura: `{ '2026-01': 44 }` vira a lista de competencias. */
function indice(valores: Record<string, number>): ValorDeIndice[] {
  return Object.entries(valores).map(([mes, basisPoints]) => ({
    referenceMonth: new Date(`${mes}-01T00:00:00.000Z`),
    variationBasisPoints: basisPoints,
  }));
}

describe('competenciasDaJanela', () => {
  it('lista os doze meses do ano anterior ao aniversario', () => {
    const meses = competenciasDaJanela(
      new Date('2025-03-01T00:00:00.000Z'),
      new Date('2026-03-01T00:00:00.000Z'),
    );

    expect(meses).toHaveLength(12);
    expect(meses[0]).toEqual(new Date('2025-03-01T00:00:00.000Z'));
    expect(meses[11]).toEqual(new Date('2026-02-01T00:00:00.000Z'));
  });

  it('atravessa a virada de ano sem pular dezembro', () => {
    const meses = competenciasDaJanela(
      new Date('2025-11-01T00:00:00.000Z'),
      new Date('2026-02-01T00:00:00.000Z'),
    );

    expect(meses.map((data) => data.toISOString().slice(0, 7))).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });
});

describe('corrigirPorIndice', () => {
  it('acumula as variacoes em vez de soma-las', () => {
    // 1% e depois 1% sobre 10.000 da 10.201, e nao 10.200. Somar as
    // variacoes ("2%") perde o juro sobre juro, e a diferenca cresce com o
    // numero de meses.
    const resultado = corrigirPorIndice(
      10_000,
      indice({ '2025-01': 1000, '2025-02': 1000 }),
      [new Date('2025-01-01T00:00:00.000Z'), new Date('2025-02-01T00:00:00.000Z')],
    );

    expect(resultado).toEqual({ corrigiu: true, valorMinor: 10_201 });
  });

  it('nao corrige quando falta o valor de uma competencia da janela', () => {
    // Aceite da fatia: sem valor cadastrado, a correcao NAO roda. Aplicar
    // so os meses que existem inventaria que os outros foram zero.
    const resultado = corrigirPorIndice(
      10_000,
      indice({ '2025-01': 1000 }),
      [new Date('2025-01-01T00:00:00.000Z'), new Date('2025-02-01T00:00:00.000Z')],
    );

    expect(resultado).toEqual({
      corrigiu: false,
      motivo: 'INDEX_VALUE_MISSING',
      competenciasFaltando: ['2025-02'],
    });
  });

  it('lista TODAS as competencias que faltam, e nao so a primeira', () => {
    const resultado = corrigirPorIndice(10_000, indice({ '2025-01': 1000 }), [
      new Date('2025-01-01T00:00:00.000Z'),
      new Date('2025-02-01T00:00:00.000Z'),
      new Date('2025-03-01T00:00:00.000Z'),
    ]);

    expect(resultado).toEqual({
      corrigiu: false,
      motivo: 'INDEX_VALUE_MISSING',
      competenciasFaltando: ['2025-02', '2025-03'],
    });
  });

  it('aceita deflacao: variacao negativa reduz o valor', () => {
    const resultado = corrigirPorIndice(10_000, indice({ '2025-01': -1000 }), [
      new Date('2025-01-01T00:00:00.000Z'),
    ]);

    expect(resultado).toEqual({ corrigiu: true, valorMinor: 9900 });
  });

  it('arredonda ao centavo mais proximo, uma vez so no fim', () => {
    // 0,44% sobre R$ 333,33 = 33.333 * 1,0044 = 33.479,66... -> 33.480.
    // Arredondar mes a mes acumularia o erro de arredondamento.
    const resultado = corrigirPorIndice(33_333, indice({ '2025-01': 440 }), [
      new Date('2025-01-01T00:00:00.000Z'),
    ]);

    expect(resultado).toEqual({ corrigiu: true, valorMinor: 33_480 });
  });

  it('janela vazia devolve o valor intacto', () => {
    // Aniversario que ainda nao venceu nao tem meses a acumular. Devolver o
    // valor original e diferente de "nao corrigiu por falta de indice".
    const resultado = corrigirPorIndice(10_000, [], []);

    expect(resultado).toEqual({ corrigiu: true, valorMinor: 10_000 });
  });
});

describe('aniversariosVencidos', () => {
  it('nao devolve nada antes do primeiro aniversario', () => {
    expect(
      aniversariosVencidos(
        new Date('2025-03-01T00:00:00.000Z'),
        1,
        3,
        new Date('2026-02-28T00:00:00.000Z'),
      ),
    ).toEqual([]);
  });

  it('devolve o aniversario no proprio dia em que ele cai', () => {
    expect(
      aniversariosVencidos(
        new Date('2025-03-01T00:00:00.000Z'),
        1,
        3,
        new Date('2026-03-01T00:00:00.000Z'),
      ),
    ).toEqual([new Date('2026-03-01T00:00:00.000Z')]);
  });

  it('devolve os DOIS aniversarios de um contrato parado por dois anos', () => {
    // O contrato que ninguem corrigiu em 2026 nao pode receber so a correcao
    // de 2027 -- perderia um ano inteiro de indice.
    expect(
      aniversariosVencidos(
        new Date('2025-03-01T00:00:00.000Z'),
        1,
        3,
        new Date('2027-06-10T00:00:00.000Z'),
      ),
    ).toEqual([
      new Date('2026-03-01T00:00:00.000Z'),
      new Date('2027-03-01T00:00:00.000Z'),
    ]);
  });

  it('aniversario 31 num mes de 30 dias cai no ultimo dia do mes', () => {
    // 31 de marco existe; 31 de abril nao. Deixar o Date "transbordar" para
    // 01/05 mudaria o mes do aniversario -- e a janela de acumulo junto.
    expect(
      aniversariosVencidos(
        new Date('2025-04-30T00:00:00.000Z'),
        31,
        4,
        new Date('2026-05-05T00:00:00.000Z'),
      ),
    ).toEqual([new Date('2026-04-30T00:00:00.000Z')]);
  });

  it('29 de fevereiro cai em 28 no ano comum', () => {
    expect(
      aniversariosVencidos(
        new Date('2024-02-29T00:00:00.000Z'),
        29,
        2,
        new Date('2025-03-10T00:00:00.000Z'),
      ),
    ).toEqual([new Date('2025-02-28T00:00:00.000Z')]);
  });
});
