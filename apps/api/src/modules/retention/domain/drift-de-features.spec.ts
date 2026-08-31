import { describe, expect, it } from '@jest/globals';

import {
  LIMIARES_PADRAO,
  compararDistribuicoes,
  type ResumoDeFeature,
} from './drift-de-features.js';

const resumo = (parcial: Partial<ResumoDeFeature> = {}): ResumoDeFeature => ({
  nome: 'attendance_days_30d',
  observados: 100,
  ausentes: 0,
  media: 10,
  ...parcial,
});

describe('compararDistribuicoes', () => {
  it('nao acusa drift quando nada mudou', () => {
    const achados = compararDistribuicoes([resumo()], [resumo()]);

    expect(achados).toEqual([]);
  });

  it('acusa salto na taxa de ausencia -- a fonte caiu', () => {
    // O drift mais comum e o mais silencioso: a fonte para de responder, a
    // feature vira ausente em massa, e o score continua saindo com completude
    // baixa que ninguem olha.
    const antes = resumo({ observados: 100, ausentes: 0 });
    const depois = resumo({ observados: 40, ausentes: 60 });

    const achados = compararDistribuicoes([antes], [depois]);

    expect(achados).toHaveLength(1);
    expect(achados[0]).toMatchObject({
      feature: 'attendance_days_30d',
      tipo: 'AUSENCIA',
      severidade: 'CRITICO',
    });
  });

  it('acusa mudanca grande na media', () => {
    const achados = compararDistribuicoes(
      [resumo({ media: 10 })],
      [resumo({ media: 25 })],
    );

    expect(achados[0]).toMatchObject({ tipo: 'MEDIA', severidade: 'CRITICO' });
  });

  it('nao acusa variacao pequena da media', () => {
    expect(compararDistribuicoes([resumo({ media: 10 })], [resumo({ media: 10.5 })])).toEqual([]);
  });

  it('classifica como ATENCAO quando cruza o primeiro limiar', () => {
    // 10 -> 13 e +30%: passa o limiar de atencao (0.25) e nao o critico (0.5).
    const achados = compararDistribuicoes([resumo({ media: 10 })], [resumo({ media: 13 })]);

    expect(achados[0]?.severidade).toBe('ATENCAO');
  });

  it('ignora feature que sumiu do periodo novo, em vez de dividir por nada', () => {
    // Catalogo de features mudou entre os periodos: e mudanca de contrato, nao
    // drift de dado, e tratar como drift produziria alarme todo dia.
    expect(compararDistribuicoes([resumo({ nome: 'sumiu' })], [resumo()])).toEqual([]);
  });

  it('ignora feature nova, que nao existia antes', () => {
    expect(compararDistribuicoes([resumo()], [resumo({ nome: 'nova' })])).toEqual([]);
  });

  it('nao divide por zero quando a media anterior era zero', () => {
    const achados = compararDistribuicoes(
      [resumo({ media: 0 })],
      [resumo({ media: 5 })],
    );

    expect(achados.every((a) => Number.isFinite(a.variacao))).toBe(true);
  });

  it('nao acusa nada quando o periodo anterior esta vazio', () => {
    // Primeira rodada do pipeline: nao ha com o que comparar, e inventar uma
    // linha de base do nada geraria alarme no dia um.
    expect(compararDistribuicoes([], [resumo()])).toEqual([]);
  });

  it('ordena por severidade e depois por nome, para ser deterministico', () => {
    const antes = [
      resumo({ nome: 'a', media: 10 }),
      resumo({ nome: 'b', media: 10 }),
      resumo({ nome: 'c', observados: 100, ausentes: 0 }),
    ];
    const depois = [
      resumo({ nome: 'a', media: 13 }),
      resumo({ nome: 'b', media: 30 }),
      resumo({ nome: 'c', observados: 20, ausentes: 80 }),
    ];

    const achados = compararDistribuicoes(antes, depois);

    expect(achados.map((a) => [a.severidade, a.feature])).toEqual([
      ['CRITICO', 'b'],
      ['CRITICO', 'c'],
      ['ATENCAO', 'a'],
    ]);
  });

  it('e deterministico para a mesma entrada', () => {
    const antes = [resumo({ media: 10 })];
    const depois = [resumo({ media: 30 })];

    expect(compararDistribuicoes(antes, depois)).toEqual(compararDistribuicoes(antes, depois));
  });

  it('tem limiares publicados', () => {
    expect(LIMIARES_PADRAO).toEqual({ atencao: 0.25, critico: 0.5 });
  });
});
