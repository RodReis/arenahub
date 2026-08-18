import { describe, expect, it } from '@jest/globals';

import {
  ValorMonetarioInvalidoError,
  precoVigenteEm,
  somarItens,
  validarValorMonetario,
} from './dinheiro.js';

/**
 * INV-065 / `M2-BR-001`: dinheiro e INTEIRO na menor unidade monetaria.
 * Nunca `float`, nunca `number` fracionario. Estes testes existem para que
 * um centavo perdido quebre o build, nao a conciliacao do cliente.
 */
describe('validarValorMonetario', () => {
  it('aceita inteiro nao negativo em centavos', () => {
    expect(() => validarValorMonetario(12000)).not.toThrow();
    expect(() => validarValorMonetario(0)).not.toThrow();
  });

  it('rejeita fracionario -- e o float que INV-065 proibe', () => {
    expect(() => validarValorMonetario(119.9)).toThrow(ValorMonetarioInvalidoError);
  });

  it('rejeita negativo', () => {
    expect(() => validarValorMonetario(-1)).toThrow(ValorMonetarioInvalidoError);
  });

  it('rejeita NaN e infinito', () => {
    expect(() => validarValorMonetario(Number.NaN)).toThrow(ValorMonetarioInvalidoError);
    expect(() => validarValorMonetario(Number.POSITIVE_INFINITY)).toThrow(
      ValorMonetarioInvalidoError,
    );
  });
});

describe('somarItens', () => {
  it('soma quantidade x valor unitario sem perder centavo', () => {
    expect(somarItens([{ quantity: 3, unitAmountMinor: 3333 }])).toBe(9999);
  });

  it('soma varios itens', () => {
    expect(
      somarItens([
        { quantity: 1, unitAmountMinor: 12000 },
        { quantity: 2, unitAmountMinor: 550 },
      ]),
    ).toBe(13100);
  });

  it('lista vazia soma zero', () => {
    expect(somarItens([])).toBe(0);
  });

  it('rejeita quantidade fracionaria', () => {
    expect(() => somarItens([{ quantity: 1.5, unitAmountMinor: 100 }])).toThrow(
      ValorMonetarioInvalidoError,
    );
  });
});

/**
 * Preco do plano e CONFIGURAVEL COM VIGENCIA (decisao do PI em 18/08/2026).
 * Reajuste nao reescreve o catalogo: entra uma linha nova com `validFrom`
 * no futuro, e a invoice de hoje continua usando o preco de hoje.
 */
describe('precoVigenteEm', () => {
  const precos = [
    { amountMinor: 12000, currency: 'BRL', validFrom: new Date('2026-01-01T00:00:00Z') },
    { amountMinor: 13000, currency: 'BRL', validFrom: new Date('2026-06-01T00:00:00Z') },
  ];

  it('escolhe o preco vigente na data', () => {
    expect(precoVigenteEm(precos, new Date('2026-03-10T00:00:00Z'))?.amountMinor).toBe(12000);
  });

  it('reajuste passa a valer a partir do validFrom', () => {
    expect(precoVigenteEm(precos, new Date('2026-06-01T00:00:00Z'))?.amountMinor).toBe(13000);
  });

  it('data anterior a qualquer vigencia nao tem preco', () => {
    expect(precoVigenteEm(precos, new Date('2025-12-31T23:59:59Z'))).toBeUndefined();
  });

  it('ordem de entrada nao importa -- ordena por vigencia', () => {
    const invertido = [...precos].reverse();
    expect(precoVigenteEm(invertido, new Date('2026-03-10T00:00:00Z'))?.amountMinor).toBe(12000);
  });

  it('catalogo vazio nao tem preco', () => {
    expect(precoVigenteEm([], new Date('2026-03-10T00:00:00Z'))).toBeUndefined();
  });
});
