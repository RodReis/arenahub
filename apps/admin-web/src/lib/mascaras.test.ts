import { describe, expect, it } from 'vitest';

import {
  mascararCep,
  mascararCnpj,
  mascararCpf,
  mascararDinheiro,
  mascararPercentual,
  mascararTelefone,
} from './mascaras';

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

describe('mascararCnpj', () => {
  it('formata o documento completo', () => {
    expect(mascararCnpj('12345678000195')).toBe('12.345.678/0001-95');
  });

  it('formata progressivamente, sem se adiantar ao que foi digitado', () => {
    // Separador que aparece antes do dígito apaga o caractere recém-escrito e
    // torna o campo impossível de preencher.
    expect(mascararCnpj('12')).toBe('12');
    expect(mascararCnpj('123')).toBe('12.3');
    expect(mascararCnpj('123456')).toBe('12.345.6');
    expect(mascararCnpj('123456789')).toBe('12.345.678/9');
  });

  it('aceita o que já vem pontuado, sem duplicar separador', () => {
    // O campo nasce preenchido pelo servidor, e o valor salvo pode ter vindo
    // com pontuação: remascarar o que já está mascarado tem de ser inócuo.
    expect(mascararCnpj('12.345.678/0001-95')).toBe('12.345.678/0001-95');
  });

  it('corta em catorze dígitos', () => {
    expect(mascararCnpj('123456780001959999')).toBe('12.345.678/0001-95');
  });
});

describe('mascararDinheiro', () => {
  it('preenche pelos centavos, da direita para a esquerda', () => {
    // É como a calculadora do balcão se comporta: o primeiro dígito é centavo.
    expect(mascararDinheiro('5')).toBe('0,05');
    expect(mascararDinheiro('50')).toBe('0,50');
    expect(mascararDinheiro('500')).toBe('5,00');
  });

  it('agrupa o milhar', () => {
    expect(mascararDinheiro('149900')).toBe('1.499,00');
    expect(mascararDinheiro('123456789')).toBe('1.234.567,89');
  });

  it('devolve vazio quando não há dígito', () => {
    // Campo limpo tem de poder ficar limpo: devolver '0,00' impediria apagar.
    expect(mascararDinheiro('')).toBe('');
    expect(mascararDinheiro('R$ ')).toBe('');
  });

  it('remascara o próprio resultado sem deslocar as casas', () => {
    expect(mascararDinheiro(mascararDinheiro('149900'))).toBe('1.499,00');
  });
});

describe('mascararPercentual', () => {
  it('formata como o IBGE publica', () => {
    expect(mascararPercentual('044')).toBe('0,44');
    expect(mascararPercentual('1250')).toBe('12,50');
  });

  it('preserva o sinal de deflação', () => {
    // Máscara que come o '-' transforma queda em alta sem ninguém ver.
    expect(mascararPercentual('-044')).toBe('-0,44');
  });

  it('mantém o sinal sozinho enquanto só ele foi digitado', () => {
    expect(mascararPercentual('-')).toBe('-');
  });
});
