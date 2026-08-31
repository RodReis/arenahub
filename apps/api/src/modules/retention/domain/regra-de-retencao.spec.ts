import { describe, expect, it } from '@jest/globals';

import {
  OPERADORES_DE_REGRA,
  avaliarRegra,
  type RegraDeRetencao,
} from './regra-de-retencao.js';
import { ausente, observado } from './valor-de-feature.js';

const regra = (parcial: Partial<RegraDeRetencao> = {}): RegraDeRetencao => ({
  id: 'r1',
  feature: 'attendance_days_30d',
  operador: 'MENOR_OU_IGUAL',
  limite: 4,
  peso: 20,
  direcao: 'AUMENTA',
  rotulo: 'Frequencia baixa no mes',
  ...parcial,
});

describe('avaliarRegra', () => {
  it('nao dispara quando a feature esta ausente', () => {
    const resultado = avaliarRegra(regra(), ausente('attendance_days_30d', 'SEM_HISTORICO'));

    expect(resultado).toBeNull();
  });

  it('dispara e contribui com o peso quando o limite e cruzado', () => {
    const resultado = avaliarRegra(regra(), observado('attendance_days_30d', 2));

    expect(resultado).toEqual({
      regraId: 'r1',
      feature: 'attendance_days_30d',
      valor: 2,
      contribuicao: 20,
      direcao: 'AUMENTA',
      rotulo: 'Frequencia baixa no mes',
    });
  });

  it('nao dispara quando o limite nao e cruzado', () => {
    expect(avaliarRegra(regra(), observado('attendance_days_30d', 12))).toBeNull();
  });

  it('trata zero observado como valor, nao como ausencia', () => {
    const resultado = avaliarRegra(regra(), observado('attendance_days_30d', 0));

    expect(resultado?.contribuicao).toBe(20);
  });

  it('devolve contribuicao negativa quando a direcao reduz o risco', () => {
    const protetora = regra({
      operador: 'MAIOR_OU_IGUAL',
      limite: 12,
      direcao: 'REDUZ',
      rotulo: 'Frequencia alta no mes',
    });

    expect(avaliarRegra(protetora, observado('attendance_days_30d', 20))?.contribuicao).toBe(-20);
  });

  it('recusa regra cuja feature nao e a do valor recebido', () => {
    expect(() => avaliarRegra(regra(), observado('days_past_due', 3))).toThrow(
      'REGRA_FEATURE_INCOMPATIVEL',
    );
  });

  it('ignora valor nao finito em vez de pontuar com NaN', () => {
    expect(avaliarRegra(regra(), observado('attendance_days_30d', Number.NaN))).toBeNull();
  });
});

describe('OPERADORES_DE_REGRA', () => {
  const casos: ReadonlyArray<
    readonly [(typeof OPERADORES_DE_REGRA)[number], number, number, boolean]
  > = [
    ['MAIOR_QUE', 5, 4, true],
    ['MAIOR_QUE', 4, 4, false],
    ['MAIOR_OU_IGUAL', 4, 4, true],
    ['MENOR_QUE', 3, 4, true],
    ['MENOR_QUE', 4, 4, false],
    ['MENOR_OU_IGUAL', 4, 4, true],
    ['QUEDA_PERCENTUAL_MINIMA', -0.5, 0.4, true],
    ['QUEDA_PERCENTUAL_MINIMA', -0.3, 0.4, false],
    ['QUEDA_PERCENTUAL_MINIMA', 0.2, 0.4, false],
  ];

  it.each(casos)('%s com valor %s e limite %s da %s', (operador, valor, limite, esperado) => {
    const resultado = avaliarRegra(
      regra({ operador, limite, feature: 'attendance_change_30d_vs_previous_30d' }),
      observado('attendance_change_30d_vs_previous_30d', valor),
    );

    expect(resultado !== null).toBe(esperado);
  });

  it('tem allowlist fechada, sem expressao executavel', () => {
    expect([...OPERADORES_DE_REGRA]).toEqual([
      'MAIOR_QUE',
      'MAIOR_OU_IGUAL',
      'MENOR_QUE',
      'MENOR_OU_IGUAL',
      'QUEDA_PERCENTUAL_MINIMA',
    ]);
  });
});
