import { describe, expect, it } from 'vitest';

import { ehRegistroDeTeste } from './importar.js';

/**
 * `ehRegistroDeTeste` e a unica decisao pura que mora no nucleo de gravacao
 * (o resto vive em `dominio.ts`, ja coberto). Ela decide se uma linha e
 * IGNORADA por inteiro -- errar para um lado deixa lixo do Pacto virando
 * gente com acesso; errar para o outro apaga uma pessoa de verdade da
 * importacao sem virar nem pendencia. A gravacao contra banco e da Task 7.
 */
describe('ehRegistroDeTeste', () => {
  it('descarta nome vazio ou so espaco', () => {
    expect(ehRegistroDeTeste('')).toBe(true);
    expect(ehRegistroDeTeste('   ')).toBe(true);
  });

  it('descarta nome que e so numero -- lixo tipico do extrator', () => {
    expect(ehRegistroDeTeste('123')).toBe(true);
    expect(ehRegistroDeTeste('  0099 ')).toBe(true);
  });

  it('descarta o marcador de POC, em qualquer caixa', () => {
    expect(ehRegistroDeTeste('TESTE-01')).toBe(true);
    expect(ehRegistroDeTeste('teste catraca')).toBe(true);
    expect(ehRegistroDeTeste('Teste')).toBe(true);
  });

  it('MANTEM pessoa de verdade, inclusive nome com numero no meio', () => {
    expect(ehRegistroDeTeste('Maria da Silva')).toBe(false);
    expect(ehRegistroDeTeste('Joao Paulo II')).toBe(false);
    // O prefixo e o criterio, nao a presenca da palavra: quem se chama
    // "Ernesto Teste" nao pode sumir da importacao.
    expect(ehRegistroDeTeste('Ernesto Teste')).toBe(false);
  });
});
