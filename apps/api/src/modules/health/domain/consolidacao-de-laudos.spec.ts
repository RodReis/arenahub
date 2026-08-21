import { describe, expect, it } from '@jest/globals';

import { consolidar, equivalentes, toleranciaDe } from './consolidacao-de-laudos.js';
import type { CampoExtraido } from './revisao-de-importacao.js';

function campo(over: Partial<CampoExtraido> & Pick<CampoExtraido, 'id' | 'type'>): CampoExtraido {
  return {
    extractedValue: null, extractedUnit: null, confidence: null,
    sourceLocation: null, state: 'PENDING', reviewedValue: null,
    reviewedUnit: null, sourceLabel: null,
    ...over,
  };
}

describe('consolidar laudos da mesma medicao', () => {
  it('funde campo concordante numa linha so, citando as duas origens', () => {
    const linhas = consolidar([
      campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg', sourceLabel: 'CF610_G' }),
      campo({ id: 'b', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg', sourceLabel: 'Unique Health' }),
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.concordante).toBe(true);
    expect(linhas[0]!.origens).toEqual(['CF610_G', 'Unique Health']);
  });

  it('trata arredondamento diferente como o MESMO valor', () => {
    // 92,25 e 92,3 sao o mesmo peso escrito com precisao diferente.
    expect(
      equivalentes(
        campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg' }),
        campo({ id: 'b', type: 'WEIGHT', extractedValue: 92.3, extractedUnit: 'kg' }),
      ),
    ).toBe(true);
  });

  it('NAO funde divergencia real: duas linhas, para o humano escolher', () => {
    const linhas = consolidar([
      campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg', sourceLabel: 'CF610_G' }),
      campo({ id: 'b', type: 'WEIGHT', extractedValue: 88.10, extractedUnit: 'kg', sourceLabel: 'Unique Health' }),
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.concordante).toBe(false);
    expect(linhas[0]!.campos).toHaveLength(2);
  });

  it('NAO funde bpm de aparelhos diferentes -- sao medicoes distintas', () => {
    const linhas = consolidar([
      campo({ id: 'a', type: 'HEART_RATE', extractedValue: 89, extractedUnit: null, sourceLabel: 'Unique Health' }),
      campo({ id: 'b', type: 'HEART_RATE', extractedValue: 99, extractedUnit: null, sourceLabel: 'ECG 30s' }),
    ]);

    expect(linhas[0]!.concordante).toBe(false);
  });

  it('converte antes de comparar: 92,25 kg e 92250 g sao o mesmo peso', () => {
    expect(
      equivalentes(
        campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg' }),
        campo({ id: 'b', type: 'WEIGHT', extractedValue: 92_250, extractedUnit: 'g' }),
      ),
    ).toBe(true);
  });

  it('valor ausente NUNCA e zero e nunca equivale a outro (INV-104)', () => {
    expect(
      equivalentes(
        campo({ id: 'a', type: 'WEIGHT', extractedValue: null, extractedUnit: 'kg' }),
        campo({ id: 'b', type: 'WEIGHT', extractedValue: 0, extractedUnit: 'kg' }),
      ),
    ).toBe(false);
  });

  it('percentual tem tolerancia mais apertada que massa', () => {
    expect(toleranciaDe('BODY_FAT_PERCENT')).toBeLessThan(toleranciaDe('WEIGHT'));
  });

  it('valor implausivel contra valor normal NAO e equivalente, e NAO propaga o throw', () => {
    // 5000 kg esta fora de FAIXA_PLAUSIVEL (WEIGHT: 2 a 500) -- converterParaCanonica
    // lancaria MedidaInvalidaError. Essa divergencia e exatamente o que o humano
    // precisa ver, entao equivalentes() tem que devolver false, nunca propagar o throw.
    expect(
      equivalentes(
        campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg' }),
        campo({ id: 'b', type: 'WEIGHT', extractedValue: 5000, extractedUnit: 'kg' }),
      ),
    ).toBe(false);
  });

  it('preserva a ordem de primeira aparicao entre tipos diferentes', () => {
    // consolidar() agrupa por Map, cuja ordem de iteracao e a de insercao --
    // mas isso e detalhe de implementacao ate um teste travar o contrato.
    // Sem essa garantia, a tela de revisao poderia reordenar as linhas entre
    // recarregamentos sem nenhum dado ter mudado.
    const linhas = consolidar([
      campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg' }),
      campo({ id: 'b', type: 'BODY_FAT_PERCENT', extractedValue: 18.5, extractedUnit: 'percent' }),
    ]);

    expect(linhas.map((linha) => linha.type)).toEqual(['WEIGHT', 'BODY_FAT_PERCENT']);
  });
});
