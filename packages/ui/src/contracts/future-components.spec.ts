import { describe, expect, it } from 'vitest';

import { AI_DISCLAIMER_CODE, RISK_BANDS } from './future-components.js';

describe('contrato de componente futuro', () => {
  it('o disclaimer de IA e o codigo exigido pela regra de arquitetura 8', () => {
    expect(AI_DISCLAIMER_CODE).toBe('NOT_MEDICAL_DIAGNOSIS');
  });

  it('faixa de risco tem intervalo publicado, nao percentual de falsa precisao', () => {
    for (const faixa of RISK_BANDS) {
      expect(faixa.range).toMatch(/^\d+–\d+$/);
    }
  });

  /**
   * Buraco entre faixas seria aluno sem classificacao; sobreposicao seria
   * aluno em duas. Os dois viram bug de operacao, nao de tela.
   */
  it('as faixas cobrem 0 a 100 sem buraco nem sobreposicao', () => {
    const limites = RISK_BANDS.map((faixa) => faixa.range.split('–').map(Number));

    expect(limites[0]?.[0]).toBe(0);
    expect(limites.at(-1)?.[1]).toBe(100);

    for (let i = 1; i < limites.length; i += 1) {
      expect(limites[i]?.[0]).toBe((limites[i - 1]?.[1] ?? 0) + 1);
    }
  });

  it('cada faixa tem tom proprio -- quatro faixas nao podem ler igual', () => {
    const tons = new Set(RISK_BANDS.map((faixa) => faixa.tone));

    expect(tons.size).toBe(RISK_BANDS.length);
  });
});
