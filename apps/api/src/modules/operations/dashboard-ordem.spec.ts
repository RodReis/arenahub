import { describe, expect, it } from '@jest/globals';

import { compararSituacoes } from './dashboard.repository.js';
import type { ContagemDeSituacao } from './dashboard.repository.js';

/**
 * Ordem das contagens por situação — F57, bloco 4.
 *
 * ## Por que este teste é UNITÁRIO, e não de integração
 *
 * A tentação era provar isto pela rota: ler duas vezes e exigir a mesma
 * ordem. **Foi tentado e o canário reprovou o teste**: removendo o desempate,
 * a suíte de integração continuou verde. A ordem física do Postgres não é
 * reproduzível sob demanda — um `UPDATE` numa tabela pequena não move a tupla
 * o bastante, e o teste passava pelo motivo errado.
 *
 * O que dá para provar de verdade é a função de comparação, alimentada com as
 * entradas **na ordem errada de propósito**. Aqui o canário funciona: sem o
 * desempate, os empates ficam na ordem de entrada e os testes caem.
 *
 * O defeito é real e foi medido no banco: os três grupos da bancada têm
 * contagem **idêntica** (5, 5, 5), e o Postgres já os devolve numa ordem que
 * não é a de inserção.
 */
describe('compararSituacoes — ordem estável do bloco de restrições', () => {
  const c = (status: string, motivo: string | null, quantidade: number): ContagemDeSituacao => ({
    status,
    motivo,
    quantidade,
  });

  it('maior quantidade primeiro', () => {
    const lista = [c('SUSPENDED', 'MEDICAL', 1), c('BLOCKED', 'DELINQUENCY', 9)];

    expect([...lista].sort(compararSituacoes).map((s) => s.quantidade)).toEqual([9, 1]);
  });

  /*
   * O CASO QUE IMPORTA: três grupos com a MESMA contagem, entregues na ordem
   * errada. Sem desempate eles ficam como vieram — e "como vieram" é a ordem
   * física do Postgres, que muda sozinha.
   */
  it('empate resolve por status e depois por motivo, não pela ordem de entrada', () => {
    const embaralhado = [
      c('SUSPENDED', 'MEDICAL', 5),
      c('BLOCKED', 'DELINQUENCY', 5),
      c('BLOCKED', 'CONDUCT', 5),
    ];

    expect([...embaralhado].sort(compararSituacoes).map((s) => `${s.status}:${s.motivo}`)).toEqual([
      'BLOCKED:CONDUCT',
      'BLOCKED:DELINQUENCY',
      'SUSPENDED:MEDICAL',
    ]);
  });

  it('a ordem é a MESMA qualquer que seja a ordem de entrada', () => {
    const grupos = [
      c('SUSPENDED', 'MEDICAL', 5),
      c('BLOCKED', 'DELINQUENCY', 5),
      c('BLOCKED', 'CONDUCT', 5),
    ];

    const chave = (lista: ContagemDeSituacao[]): string =>
      [...lista]
        .sort(compararSituacoes)
        .map((s) => `${s.status}:${s.motivo}`)
        .join('|');

    // Todas as seis permutações produzem a mesma saída.
    const permutacoes = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ].map((ordem) => chave(ordem.map((i) => grupos[i] as ContagemDeSituacao)));

    expect(new Set(permutacoes).size).toBe(1);
  });

  /*
   * `motivo: null` é quem foi bloqueado ANTES de o campo existir (#241) — os
   * importados do Pacto são todos assim. Vai por ÚLTIMO: é o caso a resolver,
   * não o cabeçalho da lista.
   */
  it('motivo ausente vai por último no empate', () => {
    const lista = [c('BLOCKED', null, 5), c('BLOCKED', 'CONDUCT', 5)];

    expect([...lista].sort(compararSituacoes).map((s) => s.motivo)).toEqual(['CONDUCT', null]);
  });
});
