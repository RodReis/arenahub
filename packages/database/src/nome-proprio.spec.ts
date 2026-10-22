import { describe, expect, it } from 'vitest';

import { nomeProprio } from './nome-proprio.js';

describe('nomeProprio', () => {
  it.each([
    // Os casos que o PI viu em produção.
    ['ANDRE LUIZ VICENTE MENEZES', 'Andre Luiz Vicente Menezes'],
    ['BRUNA Aires de sousa', 'Bruna Aires de Sousa'],
    ['FRANK EMILIO', 'Frank Emilio'],
    ['maria luiza rodrigues de morais', 'Maria Luiza Rodrigues de Morais'],
    ['Daniela Crsipim Lima de Paula', 'Daniela Crsipim Lima de Paula'],
  ])('%s → %s', (entrada, saida) => {
    expect(nomeProprio(entrada)).toBe(saida);
  });

  it('partículas em minúscula no meio, nunca no início', () => {
    expect(nomeProprio('JOAO DOS SANTOS E SILVA')).toBe('Joao dos Santos e Silva');
    expect(nomeProprio('DA SILVA SAURO')).toBe('Da Silva Sauro');
  });

  it('acento preservado e maiúscula acentuada', () => {
    expect(nomeProprio('ÉRICA ÂNGELA DA CONCEIÇÃO')).toBe('Érica Ângela da Conceição');
  });

  it('hífen e apóstrofo abrem inicial', () => {
    expect(nomeProprio("ANA-CLARA D'AVILA")).toBe("Ana-Clara D'Avila");
  });

  it('romano de sufixo fica em maiúscula', () => {
    expect(nomeProprio('PEDRO SOUZA II')).toBe('Pedro Souza II');
  });

  it('palavra com dígito fica como veio', () => {
    expect(nomeProprio('ALUNA A11y 1730000000')).toBe('Aluna A11y 1730000000');
  });

  it('espaços repetidos e nas pontas somem', () => {
    expect(nomeProprio('  carlos   alberto  ')).toBe('Carlos Alberto');
  });

  it('é idempotente', () => {
    const uma = nomeProprio('BRUNA Aires de sousa');

    expect(nomeProprio(uma)).toBe(uma);
  });
});
