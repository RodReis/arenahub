import { describe, expect, it } from '@jest/globals';

import {
  FAIXAS_PADRAO,
  MAXIMO_DE_FATORES,
  avaliarBaseline,
  faixaDoScore,
} from './avaliar-baseline.js';
import type { RegraDeRetencao } from './regra-de-retencao.js';
import { ausente, observado, type ValorDeFeature } from './valor-de-feature.js';

const regra = (parcial: Partial<RegraDeRetencao>): RegraDeRetencao => ({
  id: 'r',
  feature: 'attendance_days_30d',
  operador: 'MENOR_OU_IGUAL',
  limite: 4,
  peso: 10,
  direcao: 'AUMENTA',
  rotulo: 'rotulo',
  ...parcial,
});

describe('faixaDoScore', () => {
  it.each([
    [0, 'BAIXO'],
    [24, 'BAIXO'],
    [25, 'MEDIO'],
    [49, 'MEDIO'],
    [50, 'ALTO'],
    [74, 'ALTO'],
    [75, 'CRITICO'],
    [100, 'CRITICO'],
  ])('score %s cai na faixa %s', (score, esperada) => {
    expect(faixaDoScore(score, FAIXAS_PADRAO)).toBe(esperada);
  });
});

describe('avaliarBaseline', () => {
  it('soma so as regras que dispararam e devolve a faixa', () => {
    const resultado = avaliarBaseline(
      [observado('attendance_days_30d', 2), observado('days_past_due', 40)],
      [
        regra({ id: 'a', peso: 30 }),
        regra({ id: 'b', feature: 'days_past_due', operador: 'MAIOR_OU_IGUAL', limite: 30, peso: 30 }),
        regra({ id: 'c', feature: 'days_past_due', operador: 'MAIOR_OU_IGUAL', limite: 90, peso: 40 }),
      ],
    );

    expect(resultado.score).toBe(60);
    expect(resultado.faixa).toBe('ALTO');
    expect(resultado.fatores.map((f) => f.regraId)).toEqual(['a', 'b']);
  });

  it('nao pontua feature ausente -- M6-BR-002', () => {
    const resultado = avaliarBaseline(
      [ausente('attendance_days_30d', 'SEM_HISTORICO')],
      [regra({ id: 'a', peso: 40 })],
    );

    expect(resultado.score).toBe(0);
    expect(resultado.faixa).toBe('BAIXO');
    expect(resultado.fatores).toEqual([]);
  });

  it('ignora regra cuja feature nao esta no snapshot', () => {
    const resultado = avaliarBaseline(
      [observado('attendance_days_30d', 2)],
      [regra({ id: 'a', peso: 10 }), regra({ id: 'z', feature: 'pause_count_180d', operador: 'MAIOR_QUE', limite: 0 })],
    );

    expect(resultado.fatores.map((f) => f.regraId)).toEqual(['a']);
  });

  it('desconta fator protetor e nunca deixa o score negativo', () => {
    const resultado = avaliarBaseline(
      [observado('attendance_days_30d', 25)],
      [regra({ id: 'p', operador: 'MAIOR_OU_IGUAL', limite: 12, peso: 30, direcao: 'REDUZ' })],
    );

    expect(resultado.score).toBe(0);
    expect(resultado.fatores[0]?.contribuicao).toBe(-30);
  });

  it('limita o score em 100', () => {
    const valores = [observado('attendance_days_30d', 0), observado('days_past_due', 200)];
    const resultado = avaliarBaseline(valores, [
      regra({ id: 'a', peso: 80 }),
      regra({ id: 'b', feature: 'days_past_due', operador: 'MAIOR_QUE', limite: 0, peso: 80 }),
    ]);

    expect(resultado.score).toBe(100);
    expect(resultado.faixa).toBe('CRITICO');
  });

  it('ordena fatores por contribuicao absoluta e corta em cinco', () => {
    const valores: ValorDeFeature[] = Array.from({ length: 7 }, (_, i) =>
      observado(`f${i}`, 1),
    );
    const regras = valores.map((v, i) =>
      regra({ id: `r${i}`, feature: v.nome, operador: 'MAIOR_OU_IGUAL', limite: 1, peso: i + 1 }),
    );

    const resultado = avaliarBaseline(valores, regras);

    expect(resultado.fatores).toHaveLength(MAXIMO_DE_FATORES);
    expect(resultado.fatores.map((f) => f.regraId)).toEqual(['r6', 'r5', 'r4', 'r3', 'r2']);
    // O corte e da EXPLICACAO, nao da soma: as sete regras contam no score.
    expect(resultado.score).toBe(28);
  });

  it('desempata por id de regra para ser deterministico', () => {
    const resultado = avaliarBaseline(
      [observado('a', 1), observado('b', 1)],
      [
        regra({ id: 'z2', feature: 'b', operador: 'MAIOR_OU_IGUAL', limite: 1, peso: 10 }),
        regra({ id: 'z1', feature: 'a', operador: 'MAIOR_OU_IGUAL', limite: 1, peso: 10 }),
      ],
    );

    expect(resultado.fatores.map((f) => f.regraId)).toEqual(['z1', 'z2']);
  });

  it('e deterministico para o mesmo snapshot e a mesma versao -- M6-AC-002', () => {
    const valores = [observado('attendance_days_30d', 2), ausente('days_past_due', 'SEM_HISTORICO')];
    const regras = [regra({ id: 'a', peso: 30 })];

    expect(avaliarBaseline(valores, regras)).toEqual(avaliarBaseline(valores, regras));
  });

  it('nunca devolve probabilidade calibrada na baseline', () => {
    const resultado = avaliarBaseline([observado('attendance_days_30d', 2)], [regra({ id: 'a' })]);

    expect(resultado.probabilidadeCalibrada).toBeNull();
  });

  it('devolve a completude junto do score, sem somar uma na outra', () => {
    const resultado = avaliarBaseline(
      [observado('attendance_days_30d', 2), ausente('days_past_due', 'FONTE_INDISPONIVEL')],
      [regra({ id: 'a', peso: 30 })],
    );

    expect(resultado.score).toBe(30);
    expect(resultado.completude).toBe(0.5);
  });
});
