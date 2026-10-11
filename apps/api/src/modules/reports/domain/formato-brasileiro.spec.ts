import { describe, expect, it } from '@jest/globals';

import {
  dataParaNomeDeArquivo,
  formatarCnpj,
  formatarCpf,
  formatarDataHora,
  formatarTelefone,
  rotuloDoPlano,
} from './formato-brasileiro.js';

describe('formatarCpf', () => {
  it('aplica a máscara em 11 dígitos', () => {
    expect(formatarCpf('11144477735')).toBe('111.444.777-35');
  });
  it('mantém quem já vem formatado', () => {
    expect(formatarCpf('111.444.777-35')).toBe('111.444.777-35');
  });
  it('null vira vazio, nunca a palavra "null"', () => {
    expect(formatarCpf(null)).toBe('');
  });
  it('valor que não é CPF volta como veio (não inventa dígito)', () => {
    expect(formatarCpf('123')).toBe('123');
  });
});

describe('formatarCnpj', () => {
  it('aplica a máscara em 14 dígitos', () => {
    expect(formatarCnpj('12345678000195')).toBe('12.345.678/0001-95');
  });
  it('valor fora do padrão volta como veio', () => {
    expect(formatarCnpj('123')).toBe('123');
  });
});

describe('formatarTelefone', () => {
  it('celular com DDD', () => {
    expect(formatarTelefone('41999990000')).toBe('(41) 99999-0000');
  });
  it('fixo com DDD', () => {
    expect(formatarTelefone('4133334444')).toBe('(41) 3333-4444');
  });
  it('tira o DDI 55', () => {
    expect(formatarTelefone('+5541999990000')).toBe('(41) 99999-0000');
  });
  it('null vira vazio', () => {
    expect(formatarTelefone(null)).toBe('');
  });
  it('número fora do padrão volta como veio', () => {
    expect(formatarTelefone('12345')).toBe('12345');
  });
});

describe('formatarDataHora / dataParaNomeDeArquivo', () => {
  const instante = new Date('2026-10-10T17:32:00.000Z');

  it('usa o fuso da academia (São Paulo = UTC-3)', () => {
    expect(formatarDataHora(instante, 'America/Sao_Paulo')).toBe('10/10/2026 14:32');
  });
  it('outro fuso dá outra hora (Manaus = UTC-4)', () => {
    expect(formatarDataHora(instante, 'America/Manaus')).toBe('10/10/2026 13:32');
  });
  it('virada do dia respeita o fuso: 02:30Z de 11/10 ainda é 10/10 em São Paulo', () => {
    const virada = new Date('2026-10-11T02:30:00.000Z');

    expect(formatarDataHora(virada, 'America/Sao_Paulo')).toBe('10/10/2026 23:30');
    expect(dataParaNomeDeArquivo(virada, 'America/Sao_Paulo')).toBe('2026-10-10');
  });
});

describe('rotuloDoPlano', () => {
  it('o nome do plano vence', () => {
    expect(rotuloDoPlano('Mensal Fit', 'SUBSCRIPTION')).toBe('Mensal Fit');
  });
  it('sem plano, acesso por vínculo mostra a origem', () => {
    expect(rotuloDoPlano(null, 'EMPLOYEE')).toBe('Funcionário');
  });
  it('sem plano e sem vínculo é null (célula vazia)', () => {
    expect(rotuloDoPlano(null, null)).toBeNull();
  });
  it('origem SUBSCRIPTION sem nome de plano não ganha rótulo', () => {
    expect(rotuloDoPlano(null, 'SUBSCRIPTION')).toBeNull();
  });
  it('origem desconhecida cai no próprio código, nunca em branco', () => {
    expect(rotuloDoPlano(null, 'NOVA_ORIGEM')).toBe('NOVA_ORIGEM');
  });
});
