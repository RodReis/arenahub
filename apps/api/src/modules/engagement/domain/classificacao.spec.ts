import { describe, expect, it } from '@jest/globals';

import { classificar, type SaldoParaClassificar } from './classificacao.js';

const saldo = (
  studentId: string,
  points: number,
  iso: string,
): SaldoParaClassificar => ({ studentId, points, lastEntryAt: new Date(iso) });

describe('classificar', () => {
  it('ordena por XP decrescente', () => {
    const placar = classificar([
      saldo('b', 20, '2026-08-10T12:00:00Z'),
      saldo('a', 50, '2026-08-11T12:00:00Z'),
      saldo('c', 35, '2026-08-12T12:00:00Z'),
    ]);

    expect(placar.map((p) => p.studentId)).toEqual(['a', 'c', 'b']);
    expect(placar.map((p) => p.position)).toEqual([1, 2, 3]);
  });

  /*
   * Criterio 2: quem chegou primeiro ao mesmo total fica na frente. Premia
   * a consistencia e nao o acaso da ordem do banco.
   */
  it('empate em XP: quem atingiu primeiro fica na frente', () => {
    const placar = classificar([
      saldo('tarde', 30, '2026-08-20T12:00:00Z'),
      saldo('cedo', 30, '2026-08-05T12:00:00Z'),
    ]);

    expect(placar.map((p) => p.studentId)).toEqual(['cedo', 'tarde']);
  });

  /*
   * Criterio 3, o que fecha a porta do sorteio (`M5-BR-008`). Empate
   * TOTAL -- mesmo XP e mesmo instante -- ainda tem de produzir sempre a
   * mesma ordem.
   */
  it('empate total: desempata por studentId, de forma estavel', () => {
    const placar = classificar([
      saldo('zeta', 30, '2026-08-05T12:00:00Z'),
      saldo('alfa', 30, '2026-08-05T12:00:00Z'),
    ]);

    expect(placar.map((p) => p.studentId)).toEqual(['alfa', 'zeta']);
  });

  /*
   * O TESTE QUE PROVA O `M5-BR-008`. Rodar sobre a entrada embaralhada tem
   * de dar a mesma ordem -- a memoria `include-sem-orderby-embaralha`
   * registra que a ordem fisica do Postgres muda depois de um UPDATE, e um
   * sort instavel deixaria o placar mudar sozinho entre duas leituras.
   */
  it('produz a mesma ordem com a entrada embaralhada', () => {
    const entrada = [
      saldo('a', 30, '2026-08-05T12:00:00Z'),
      saldo('b', 30, '2026-08-05T12:00:00Z'),
      saldo('c', 30, '2026-08-05T12:00:00Z'),
      saldo('d', 50, '2026-08-05T12:00:00Z'),
    ];

    expect(classificar(entrada)).toEqual(classificar([...entrada].reverse()));
  });

  it('lista vazia devolve placar vazio', () => {
    expect(classificar([])).toEqual([]);
  });

  it('nao muta a lista de entrada', () => {
    const entrada = [saldo('b', 20, '2026-08-10T12:00:00Z'), saldo('a', 50, '2026-08-11T12:00:00Z')];

    classificar(entrada);

    expect(entrada.map((s) => s.studentId)).toEqual(['b', 'a']);
  });
});
