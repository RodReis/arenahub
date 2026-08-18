import { describe, expect, it } from 'vitest';

import { paraCentavos } from './dinheiro';

/**
 * INV-065: dinheiro é inteiro em centavos. Estes testes existem para que um
 * centavo perdido quebre o build, não a conciliação do cliente.
 */
describe('paraCentavos', () => {
  it('converte o formato brasileiro do balcão', () => {
    expect(paraCentavos('150,00')).toBe(15000);
    expect(paraCentavos('200,00')).toBe(20000);
    expect(paraCentavos('30,00')).toBe(3000);
  });

  it('aceita ponto como separador', () => {
    expect(paraCentavos('150.00')).toBe(15000);
  });

  it('aceita valor sem casas decimais', () => {
    expect(paraCentavos('150')).toBe(15000);
  });

  it('completa uma casa decimal só', () => {
    expect(paraCentavos('150,5')).toBe(15050);
  });

  it('ignora espaços em volta', () => {
    expect(paraCentavos('  150,00 ')).toBe(15000);
  });

  it('não perde centavo em valor que o float estragaria', () => {
    // `Number('1.15') * 100` dá 114.99999999999999 em float.
    expect(paraCentavos('1,15')).toBe(115);
    expect(paraCentavos('0,29')).toBe(29);
    expect(paraCentavos('8,07')).toBe(807);
  });

  it('rejeita mais de duas casas -- nao arredonda', () => {
    expect(paraCentavos('150,005')).toBeNull();
  });

  it('rejeita texto, vazio e negativo', () => {
    expect(paraCentavos('abc')).toBeNull();
    expect(paraCentavos('')).toBeNull();
    expect(paraCentavos('-10,00')).toBeNull();
  });

  it('rejeita separador de milhar -- ambiguo entre pt-BR e en-US', () => {
    expect(paraCentavos('1.500,00')).toBeNull();
  });
});
