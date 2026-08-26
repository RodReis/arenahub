import { describe, expect, it } from 'vitest';

import { ESCALA_DA_PONTUACAO, PERIMETRO, fracaoDaPontuacao, tracadoDoArco } from './pontuacao.js';

describe('fracao da pontuacao (DS-TOTEM §3.12)', () => {
  it('numero dentro da escala vira fracao', () => {
    expect(fracaoDaPontuacao('80')).toBeCloseTo(0.8);
    expect(fracaoDaPontuacao('0')).toBe(0);
  });

  it('aceita decimal com virgula, que e como o aparelho reporta em pt-BR', () => {
    expect(fracaoDaPontuacao('72,5')).toBeCloseTo(0.725);
  });

  /**
   * O caso que justifica a funcao existir: o campo e TEXTO LIVRE do aparelho.
   * Sem anel e o resultado certo -- a tela cai no numero em texto, que ja
   * funcionava. Desenhar um arco a partir de "Condicao boa" seria inventar
   * leitura sobre dado de saude (regra de arquitetura 8).
   */
  it.each([['texto'], ['Condicao boa'], [''], ['   '], ['--'], ['NaN']])(
    'recusa o anel para %o',
    (bruto) => {
      expect(fracaoDaPontuacao(bruto)).toBeNull();
    },
  );

  it('recusa negativo em vez de desenhar arco ao contrario', () => {
    expect(fracaoDaPontuacao('-5')).toBeNull();
  });

  /**
   * DEFEITO PEGO NA REVISAO DESTA FATIA, antes do commit. `Number()` sozinho
   * entende notacao de literal de JavaScript, e o campo e texto reportado por
   * um APARELHO, nao codigo:
   *   "0x10" -> 16  (anel de 16%, silenciosamente)
   *   "0b11" -> 3
   *   "1e3"  -> 1000 (saturava o anel no cheio)
   * Todos tinham de ser `null`. Com `Number()` puro estes casos PASSAVAM e
   * desenhavam um anel errado sobre dado de saude.
   */
  it.each([['0x10'], ['0b11'], ['0o17'], ['1e3'], ['+80'], ['1_000'], ['Infinity']])(
    'recusa a notacao de literal de JS %o',
    (bruto) => {
      expect(fracaoDaPontuacao(bruto)).toBeNull();
    },
  );

  /**
   * Aparelho que reporte acima da escala assumida nao pode dar a volta no
   * anel: 120/100 seria 1.2, e o arco voltaria a parecer 20.
   */
  it('satura no cheio acima da escala', () => {
    expect(fracaoDaPontuacao(String(ESCALA_DA_PONTUACAO * 1.2))).toBe(1);
  });
});

describe('tracado do arco', () => {
  it('cheio pinta o perimetro inteiro e nao deixa vao', () => {
    expect(tracadoDoArco(1)).toBe(`${PERIMETRO.toFixed(2)} 0.00`);
  });

  it('vazio nao pinta nada', () => {
    expect(tracadoDoArco(0)).toBe(`0.00 ${PERIMETRO.toFixed(2)}`);
  });

  it('metade divide o perimetro em dois', () => {
    expect(tracadoDoArco(0.5)).toBe('182.00 182.00');
  });
});
