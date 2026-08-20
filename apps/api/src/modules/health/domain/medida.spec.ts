import { describe, expect, it } from '@jest/globals';

import {
  MedidaInvalidaError,
  UnidadeIncompativelError,
  arredondarParaExibicao,
  calcularImc,
  converterParaCanonica,
} from './medida.js';

/**
 * INV-105: a unidade ORIGINAL e preservada e a conversao usa regra testada.
 *
 * O teste que importa aqui nao e "converte lb para kg" -- e que o par
 * original sobrevive a conversao. Sem ele nao ha como descobrir, meses
 * depois, que a balanca da unidade nova reportava em libras.
 */
describe('converterParaCanonica', () => {
  it('preserva valor e unidade originais junto do canonico', () => {
    const medida = converterParaCanonica({ type: 'WEIGHT', value: 154, unit: 'lb' });

    expect(medida.originalValue).toBe(154);
    expect(medida.originalUnit).toBe('lb');
    expect(medida.canonicalUnit).toBe('kg');
    expect(medida.canonicalValue).toBeCloseTo(69.853, 3);
  });

  it('nao converte quando a unidade ja e a canonica', () => {
    const medida = converterParaCanonica({ type: 'WEIGHT', value: 69.7, unit: 'kg' });

    expect(medida.canonicalValue).toBe(69.7);
    expect(medida.originalValue).toBe(69.7);
  });

  it('converte metro para centimetro na altura', () => {
    const medida = converterParaCanonica({ type: 'HEIGHT', value: 1.78, unit: 'm' });

    expect(medida.canonicalValue).toBeCloseTo(178, 6);
    expect(medida.originalUnit).toBe('m');
  });

  it('aceita agua em kg pela equivalencia 1 kg = 1 L do proprio fabricante', () => {
    const medida = converterParaCanonica({ type: 'TOTAL_BODY_WATER', value: 42.3, unit: 'kg' });

    expect(medida.canonicalValue).toBeCloseTo(42.3, 6);
    expect(medida.originalUnit).toBe('kg');
  });

  it('recusa unidade de outra grandeza em vez de multiplicar por fator inventado', () => {
    expect(() => converterParaCanonica({ type: 'WEIGHT', value: 70, unit: 'cm' })).toThrow(
      UnidadeIncompativelError,
    );
  });

  it('recusa zero -- ausencia nao e zero (INV-104)', () => {
    expect(() => converterParaCanonica({ type: 'WEIGHT', value: 0, unit: 'kg' })).toThrow(
      MedidaInvalidaError,
    );
  });

  it('recusa negativo e nao finito', () => {
    expect(() => converterParaCanonica({ type: 'WEIGHT', value: -1, unit: 'kg' })).toThrow(
      MedidaInvalidaError,
    );
    expect(() => converterParaCanonica({ type: 'WEIGHT', value: Number.NaN, unit: 'kg' })).toThrow(
      MedidaInvalidaError,
    );
  });

  it('pega o erro de digitacao que troca a virgula de lugar', () => {
    // 750 kg em vez de 75,0 kg: plausivel como digito, impossivel como pessoa.
    expect(() => converterParaCanonica({ type: 'WEIGHT', value: 750, unit: 'kg' })).toThrow(
      MedidaInvalidaError,
    );
  });

  it('valida a faixa DEPOIS de converter, nao antes', () => {
    // 154 lb = 69,85 kg: dentro da faixa. Validar antes da conversao
    // reprovaria 154 contra a faixa de kg em algum tipo de faixa estreita.
    expect(() => converterParaCanonica({ type: 'WEIGHT', value: 154, unit: 'lb' })).not.toThrow();
  });

  it('aceita indice adimensional sem unidade', () => {
    const medida = converterParaCanonica({ type: 'VISCERAL_FAT_LEVEL', value: 8, unit: null });

    expect(medida.canonicalUnit).toBeNull();
    expect(medida.canonicalValue).toBe(8);
  });

  it('recusa unidade em tipo adimensional', () => {
    expect(() =>
      converterParaCanonica({ type: 'VISCERAL_FAT_LEVEL', value: 8, unit: 'kg' }),
    ).toThrow(UnidadeIncompativelError);
  });

  it('exige unidade em tipo dimensional', () => {
    expect(() => converterParaCanonica({ type: 'WEIGHT', value: 70, unit: null })).toThrow(
      MedidaInvalidaError,
    );
  });
});

/**
 * INV-107: IMC vem de peso e altura validos, preservando as entradas.
 * INV-104: campo ausente permanece ausente -- nunca zero.
 */
describe('calcularImc', () => {
  it('calcula a partir de kg e cm', () => {
    expect(calcularImc(69.7, 178)).toBeCloseTo(21.9985, 4);
  });

  it('devolve null quando falta peso -- nunca zero (INV-104)', () => {
    expect(calcularImc(null, 178)).toBeNull();
    expect(calcularImc(undefined, 178)).toBeNull();
  });

  it('devolve null quando falta altura -- nunca zero (INV-104)', () => {
    expect(calcularImc(69.7, null)).toBeNull();
    expect(calcularImc(69.7, undefined)).toBeNull();
  });

  it('devolve null para entrada nao positiva em vez de dividir por zero', () => {
    expect(calcularImc(69.7, 0)).toBeNull();
    expect(calcularImc(0, 178)).toBeNull();
    expect(calcularImc(-1, 178)).toBeNull();
  });

  it('devolve null para nao finito', () => {
    expect(calcularImc(Number.NaN, 178)).toBeNull();
    expect(calcularImc(69.7, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('nao arredonda -- a precisao inteira segue para o comparativo (INV-106)', () => {
    const imc = calcularImc(69.7, 178);

    // 21.99 arredondado seria indistinguivel de 21.994 e de 21.985; a
    // diferenca aparece quando o comparativo subtrai duas avaliacoes.
    expect(imc).not.toBe(21.99);
    expect(imc).not.toBe(22);
  });
});

describe('arredondarParaExibicao', () => {
  it('arredonda para as casas pedidas', () => {
    expect(arredondarParaExibicao(21.99943, 2)).toBe(22);
    expect(arredondarParaExibicao(21.994, 2)).toBe(21.99);
    expect(arredondarParaExibicao(69.853_18, 1)).toBe(69.9);
  });
});
