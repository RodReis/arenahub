import { describe, expect, it } from '@jest/globals';

import { lerFaixa, leituraDoPercentual } from './leitura-de-faixa.js';

describe('leitura de faixa de referencia', () => {
  it('classifica dentro, abaixo e acima', () => {
    expect(lerFaixa(35, 30.6, 37.4)).toBe('WITHIN');
    expect(lerFaixa(28, 30.6, 37.4)).toBe('BELOW');
    expect(lerFaixa(39.8, 30.6, 37.4)).toBe('ABOVE');
  });

  it('marca o limite exato como AT_LIMIT, nao como dentro', () => {
    // Gordura visceral 9 na faixa 1-9: o laudo escreve "no limite", e
    // arredondar para "dentro" esconderia do professor que o proximo mes
    // pode sair da faixa.
    expect(lerFaixa(9, 1, 9)).toBe('AT_LIMIT');
  });

  it('sem faixa ou sem valor nao inventa leitura (INV-104)', () => {
    expect(lerFaixa(35, null, null)).toBe('UNKNOWN');
    expect(lerFaixa(null, 30.6, 37.4)).toBe('UNKNOWN');
  });

  it('le percentual do padrao com 100 como centro', () => {
    expect(leituraDoPercentual(100)).toBe('WITHIN');
    expect(leituraDoPercentual(233.3)).toBe('ABOVE');
    expect(leituraDoPercentual(88)).toBe('BELOW');
    expect(leituraDoPercentual(null)).toBe('UNKNOWN');
  });

  it('avalia so com o minimo presente (laudo que so imprime piso)', () => {
    expect(lerFaixa(10, 5, null)).toBe('WITHIN');
    expect(lerFaixa(3, 5, null)).toBe('BELOW');
    expect(lerFaixa(5, 5, null)).toBe('AT_LIMIT');
  });

  it('avalia so com o maximo presente', () => {
    expect(lerFaixa(10, null, 20)).toBe('WITHIN');
    expect(lerFaixa(25, null, 20)).toBe('ABOVE');
    expect(lerFaixa(20, null, 20)).toBe('AT_LIMIT');
  });
});
