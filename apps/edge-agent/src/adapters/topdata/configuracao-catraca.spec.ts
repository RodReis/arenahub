import { describe, expect, it } from '@jest/globals';

import { derivarConfiguracao, MODOS_CATRACA, type ModoCatraca } from './configuracao-catraca.js';

/**
 * #658 -- a tabela e o contrato: espelho do `MontaConfiguracaoInner` do
 * exemplo oficial do SDK EasyInner 6.0.2.0.
 */
describe('derivarConfiguracao', () => {
  it('Arena Positiva: saida liberada + invertida grava acionamento 7, leitor 2', () => {
    expect(derivarConfiguracao('saida-liberada', true)).toEqual({
      acionamento1: 7,
      leitor1: 2,
      leitor2: 0,
    });
  });

  it.each<[ModoCatraca, boolean, number, number]>([
    ['entrada-e-saida', false, 1, 3],
    ['entrada-e-saida', true, 1, 3],
    ['so-entrada', false, 2, 1],
    ['so-entrada', true, 3, 2],
    ['so-saida', false, 3, 2],
    ['so-saida', true, 2, 1],
    ['saida-liberada', false, 6, 1],
    ['saida-liberada', true, 7, 2],
    ['entrada-liberada', false, 7, 2],
    ['entrada-liberada', true, 6, 1],
    ['dois-sentidos-liberados', false, 8, 3],
    ['dois-sentidos-liberados', true, 8, 3],
  ])('%s invertida=%s -> acionamento %i, leitor %i', (modo, inv, acionamento1, leitor1) => {
    expect(derivarConfiguracao(modo, inv)).toEqual({ acionamento1, leitor1, leitor2: 0 });
  });

  it('nunca gera leitor fora de 0 a 4 (a DLL devolve 128)', () => {
    for (const modo of MODOS_CATRACA) {
      for (const inv of [false, true]) {
        const { leitor1, leitor2 } = derivarConfiguracao(modo, inv);
        expect(leitor1).toBeLessThanOrEqual(4);
        expect(leitor2).toBe(0);
      }
    }
  });
});
