import { describe, expect, it } from '@jest/globals';

import { normalizarCep, ufEhValida } from './endereco.js';

describe('normalizarCep', () => {
  it('reduz a digitos: mascara e valor cru viram a mesma coisa', () => {
    expect(normalizarCep('80010-000')).toBe('80010000');
    expect(normalizarCep('80010000')).toBe('80010000');
    expect(normalizarCep(' 80.010-000 ')).toBe('80010000');
  });

  it('devolve null para o que nao tem oito digitos', () => {
    // CEP com sete digitos e erro de digitacao, nao CEP curto: gravar assim
    // faria a correspondencia com base de logradouro falhar em silencio.
    expect(normalizarCep('8001000')).toBeNull();
    expect(normalizarCep('800100000')).toBeNull();
    expect(normalizarCep('')).toBeNull();
    expect(normalizarCep('abcdefgh')).toBeNull();
  });
});

describe('ufEhValida', () => {
  it('aceita as 27 unidades federativas, em qualquer caixa', () => {
    expect(ufEhValida('PR')).toBe(true);
    expect(ufEhValida('sp')).toBe(true);
    expect(ufEhValida('DF')).toBe(true);
  });

  it('recusa sigla que nao existe', () => {
    // "XX" passaria por qualquer regex de duas letras. A lista fechada e o
    // que impede endereco com UF inventada entrar no banco.
    expect(ufEhValida('XX')).toBe(false);
    expect(ufEhValida('P')).toBe(false);
    expect(ufEhValida('PRR')).toBe(false);
    expect(ufEhValida('')).toBe(false);
  });
});
