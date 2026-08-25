import { describe, expect, it } from 'vitest';

import { formatarDinheiro, percentualDoTotal } from './dinheiro.js';

describe('formatarDinheiro', () => {
  /**
   * O DEFEITO QUE ESTE HELPER EXISTE PARA IMPEDIR.
   *
   * A tela do painel financeiro fazia `(minor / 100).toFixed(2)` e desenhava
   * `R$ 12000,00` no rotulo do grafico de dividas. Doze mil sem separador se
   * confunde com mil e duzentos de relance -- num grafico que existe para
   * comparar tamanhos, e o erro que faz a comparacao mentir.
   */
  it('separa o milhar', () => {
    // ` ` -- o `Intl` usa espaco NAO separavel entre simbolo e numero, e
    // e isso que impede "R$" e o valor caírem em linhas diferentes.
    expect(formatarDinheiro(1_200_000)).toBe('R$ 12.000,00');
  });

  it('formata valor abaixo de mil', () => {
    expect(formatarDinheiro(15_000)).toBe('R$ 150,00');
  });

  it('formata zero', () => {
    expect(formatarDinheiro(0)).toBe('R$ 0,00');
  });

  it('separa milhao', () => {
    expect(formatarDinheiro(123_456_789)).toBe('R$ 1.234.567,89');
  });

  /** Mesma decisao do `Money`: falhar alto e mais barato que procurar depois. */
  it('recusa float, em vez de arredondar', () => {
    expect(() => formatarDinheiro(1234.56)).toThrow(/nao e inteiro/);
  });

  it('aceita outra moeda', () => {
    expect(formatarDinheiro(1_000, 'USD')).toContain('10,00');
  });
});

describe('percentualDoTotal', () => {
  it('calcula a proporcao com uma casa', () => {
    expect(percentualDoTotal(21_750, 37_850)).toBe(57.5);
  });

  it('devolve 100 quando a parte e o total', () => {
    expect(percentualDoTotal(500, 500)).toBe(100);
  });

  it('devolve zero quando a parte e zero e ha total', () => {
    expect(percentualDoTotal(0, 500)).toBe(0);
  });

  /**
   * `null` E NAO ZERO: uma fatia de nada nao e 0% do total -- e uma proporcao
   * que nao existe. Mostrar "0%" afirmaria que a parte e desprezivel quando
   * nao ha do que ser parte.
   */
  it('devolve null quando o total e zero, nunca zero por cento', () => {
    expect(percentualDoTotal(0, 0)).toBeNull();
  });
});
