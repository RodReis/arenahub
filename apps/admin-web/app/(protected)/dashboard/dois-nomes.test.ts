import { describe, expect, it } from 'vitest';

import { doisNomes } from './dois-nomes';

/**
 * Primeiro e segundo nome — F57, pedido do PI.
 *
 * O que estes testes defendem não é "corta no segundo espaço": é que o
 * resultado IDENTIFIQUE a pessoa. "Ana de" e "Ana C." não identificam
 * ninguém, e é por causa deles que a função existe em vez de um `split`
 * inline.
 */
describe('doisNomes', () => {
  it('devolve primeiro e segundo nome', () => {
    expect(doisNomes('Marina Chaves Oliveira')).toBe('Marina Chaves');
    expect(doisNomes('Bruna Barbara Militao Vieira')).toBe('Bruna Barbara');
  });

  /*
   * PARTÍCULA NÃO É SEGUNDO NOME. "Ana de Souza" viraria "Ana de", que não
   * identifica ninguém -- e é justamente o caso que mais aparece numa base
   * brasileira.
   */
  it('pula partícula e pega o nome que vem depois', () => {
    expect(doisNomes('Ana de Souza')).toBe('Ana Souza');
    expect(doisNomes('João dos Santos Silva')).toBe('João Santos');
    expect(doisNomes('Maria da Conceição')).toBe('Maria Conceição');
  });

  it('nome único devolve ele mesmo', () => {
    expect(doisNomes('Madonna')).toBe('Madonna');
  });

  /*
   * NOME SÓ DE PARTÍCULAS depois do primeiro: devolve o primeiro em vez de
   * uma string com espaço sobrando no fim.
   */
  it('sem segundo nome utilizável, devolve só o primeiro', () => {
    expect(doisNomes('Ana de')).toBe('Ana');
  });

  it('normaliza espaço extra e não quebra com string vazia', () => {
    expect(doisNomes('  Pedro   Alves  ')).toBe('Pedro Alves');
    expect(doisNomes('')).toBe('');
    expect(doisNomes('   ')).toBe('');
  });

  /*
   * MAIÚSCULA NA PARTÍCULA acontece em cadastro digitado no balcão -- "Ana De
   * Souza". Comparar sem normalizar deixaria passar "Ana De".
   */
  it('reconhece partícula escrita em maiúscula', () => {
    expect(doisNomes('Ana De Souza')).toBe('Ana Souza');
  });
});
