import { describe, expect, it } from 'vitest';

import { apenasDigitos, cpfEstaCompleto, mascararCpf } from './cpf.js';

describe('mascara de CPF (DS-TOTEM.md §3.19)', () => {
  it('mostra sublinhado nas posicoes vazias', () => {
    expect(mascararCpf('')).toBe('___.___.___-__');
  });

  it('preenche da esquerda para a direita, mantendo os separadores', () => {
    expect(mascararCpf('123')).toBe('123.___.___-__');
    expect(mascararCpf('1234')).toBe('123.4__.___-__');
  });

  it('completa a mascara com os 11 digitos', () => {
    expect(mascararCpf('00000000191')).toBe('000.000.001-91');
  });

  it('descarta o que nao e digito e trava em 11', () => {
    expect(apenasDigitos('000.000.001-91')).toBe('00000000191');
    expect(apenasDigitos('000000001919999')).toBe('00000000191');
  });

  it('so esta completo com exatamente 11 digitos', () => {
    expect(cpfEstaCompleto('0000000019')).toBe(false);
    expect(cpfEstaCompleto('00000000191')).toBe(true);
  });
});
