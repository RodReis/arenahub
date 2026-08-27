import { describe, expect, it } from '@jest/globals';

import { avaliarConquistas, type DefinicaoDeConquista } from './conquista.js';

const marcos: DefinicaoDeConquista[] = [
  { id: 'd1', code: 'primeiro-treino', version: 1, title: 'Primeiro treino', criterionKind: 'SESSOES_ACUMULADAS', threshold: 1 },
  { id: 'd2', code: 'dez-treinos', version: 1, title: '10 treinos', criterionKind: 'SESSOES_ACUMULADAS', threshold: 10 },
  { id: 'd3', code: 'cinquenta-treinos', version: 1, title: '50 treinos', criterionKind: 'SESSOES_ACUMULADAS', threshold: 50 },
];

describe('avaliarConquistas', () => {
  it('desbloqueia todos os marcos alcancados', () => {
    const desbloqueadas = avaliarConquistas(
      marcos,
      { sessoesAcumuladas: 12, ultimoMovimentoId: 'e42' },
      new Set(),
    );

    expect(desbloqueadas.map((d) => d.definicao.code)).toEqual([
      'primeiro-treino',
      'dez-treinos',
    ]);
  });

  it('anexa o movimento do ledger como evidencia', () => {
    const [primeira] = avaliarConquistas(
      marcos,
      { sessoesAcumuladas: 1, ultimoMovimentoId: 'e7' },
      new Set(),
    );

    expect(primeira?.evidenceEntryId).toBe('e7');
  });

  /*
   * O CASO QUE FAZ A FUNCAO EXISTIR. Sem ele, cada visita a tela tentaria
   * reinserir toda conquista ja obtida -- a chave unica seguraria, mas o
   * servico gastaria uma escrita recusada por conquista, por visita.
   */
  it('nao redesbloqueia o que ja esta desbloqueado', () => {
    const desbloqueadas = avaliarConquistas(
      marcos,
      { sessoesAcumuladas: 12, ultimoMovimentoId: 'e42' },
      new Set(['d1']),
    );

    expect(desbloqueadas.map((d) => d.definicao.code)).toEqual(['dez-treinos']);
  });

  it('nao desbloqueia marco nao alcancado', () => {
    expect(
      avaliarConquistas(marcos, { sessoesAcumuladas: 9, ultimoMovimentoId: 'e9' }, new Set()),
    ).toHaveLength(1);
  });

  it('sem sessao nenhuma, nada desbloqueia', () => {
    expect(
      avaliarConquistas(marcos, { sessoesAcumuladas: 0, ultimoMovimentoId: 'e0' }, new Set()),
    ).toEqual([]);
  });

  /*
   * Ordem por limiar crescente e nao pela ordem do array: o repositorio
   * devolve na ordem do banco, e a tela mostra a trajetoria do aluno.
   */
  it('devolve em ordem crescente de limiar', () => {
    const embaralhado = [marcos[2]!, marcos[0]!, marcos[1]!];

    expect(
      avaliarConquistas(
        embaralhado,
        { sessoesAcumuladas: 50, ultimoMovimentoId: 'e50' },
        new Set(),
      ).map((d) => d.definicao.threshold),
    ).toEqual([1, 10, 50]);
  });
});
