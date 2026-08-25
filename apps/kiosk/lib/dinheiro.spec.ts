import { describe, expect, it } from 'vitest';

import { formatarDinheiro } from './dinheiro.js';

describe('dinheiro no totem (M2-BR-001)', () => {
  it('formata centavos inteiros com separador de milhar', () => {
    // `\u00A0` -- o Intl usa espaco NAO separavel depois de "R$".
    expect(formatarDinheiro(12990)).toBe('R$\u00A0129,90');
    expect(formatarDinheiro(1200000)).toBe('R$\u00A012.000,00');
  });

  /**
   * RECUSA float em vez de arredondar: se um fracionario chegou aqui, alguem
   * ja errou antes, e arredondar esconderia o bug de origem. E o unico
   * comportamento nao obvio desta copia -- por isso e o que o teste prende.
   */
  it('recusa valor fracionario', () => {
    expect(() => formatarDinheiro(129.9)).toThrow(/nao e inteiro/);
  });
});
