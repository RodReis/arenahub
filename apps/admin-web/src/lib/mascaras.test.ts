import { describe, expect, it } from 'vitest';

import { mascararCep, mascararCpf, mascararTelefone } from './mascaras';

/**
 * Máscara de entrada é lógica pura — sem DOM, sem React.
 *
 * O que estes testes protegem não é a formatação bonita: é a **digitação
 * progressiva**. Quem digita "4" tem de ver "4", não "(4" nem "(4) ) -".
 * Máscara que se adianta ao usuário apaga o próprio caractere que ele acabou
 * de escrever, e o campo fica impossível de preencher.
 */

describe('mascararCpf', () => {
  it('formata progressivamente, sem inventar pontuação adiante', () => {
    expect(mascararCpf('1')).toBe('1');
    expect(mascararCpf('123')).toBe('123');
    expect(mascararCpf('1234')).toBe('123.4');
    expect(mascararCpf('1234567')).toBe('123.456.7');
    expect(mascararCpf('11144477735')).toBe('111.444.777-35');
  });

  it('descarta o que passa de onze dígitos', () => {
    // Sem o corte, colar um texto longo produziria um CPF impossível que só
    // seria recusado depois, no servidor.
    expect(mascararCpf('111444777359999')).toBe('111.444.777-35');
  });

  it('ignora o que não é dígito', () => {
    expect(mascararCpf('111.444.777-35')).toBe('111.444.777-35');
    expect(mascararCpf('abc111')).toBe('111');
    expect(mascararCpf('')).toBe('');
  });
});

describe('mascararCep', () => {
  it('formata progressivamente', () => {
    expect(mascararCep('8')).toBe('8');
    expect(mascararCep('80010')).toBe('80010');
    expect(mascararCep('800100')).toBe('80010-0');
    expect(mascararCep('80010000')).toBe('80010-000');
  });

  it('corta em oito dígitos', () => {
    expect(mascararCep('800100009999')).toBe('80010-000');
  });
});

describe('mascararTelefone', () => {
  it('formata celular de nove dígitos', () => {
    expect(mascararTelefone('41999990000')).toBe('(41) 99999-0000');
  });

  it('formata fixo de oito dígitos', () => {
    // Fixo e celular têm formatos distintos. Um único formato deixaria o
    // fixo com um dígito no lugar errado do hífen.
    expect(mascararTelefone('4133330000')).toBe('(41) 3333-0000');
  });

  it('formata progressivamente, do DDD ao número', () => {
    expect(mascararTelefone('4')).toBe('(4');
    expect(mascararTelefone('41')).toBe('(41');
    expect(mascararTelefone('419')).toBe('(41) 9');
    expect(mascararTelefone('419999')).toBe('(41) 9999');
  });

  it('corta em onze dígitos', () => {
    expect(mascararTelefone('419999900009999')).toBe('(41) 99999-0000');
  });
});
