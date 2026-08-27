/**
 * Criterio de conquista -- DECLARATIVO, avaliado contra EVIDENCIA.
 *
 * `M5-FR-006`: conquista sai de fato verificado, nunca de alegacao do
 * cliente. A evidencia aqui e a contagem de sessoes ja materializada no
 * ledger, e cada desbloqueio carrega o id do movimento que a provou.
 *
 * PURA: sem banco, sem relogio.
 */

export type CriterioDeConquista = 'SESSOES_ACUMULADAS';

export interface DefinicaoDeConquista {
  id: string;
  code: string;
  version: number;
  title: string;
  criterionKind: CriterioDeConquista;
  threshold: number;
}

export interface EvidenciaDeConquista {
  sessoesAcumuladas: number;
  /** O movimento do ledger que levou o aluno a esta contagem. */
  ultimoMovimentoId: string;
}

export interface ConquistaADesbloquear {
  definicao: DefinicaoDeConquista;
  evidenceEntryId: string;
}

/**
 * As conquistas que este aluno acaba de alcancar.
 *
 * `jaDesbloqueadas` evita gastar uma escrita recusada por conquista a cada
 * visita a tela: a chave unica no banco seguraria de qualquer forma, mas
 * pagar o custo da recusa em toda leitura e desperdicio previsivel.
 *
 * Ordena por limiar CRESCENTE, nao pela ordem de entrada: o repositorio
 * devolve na ordem do banco, e a tela mostra a trajetoria do aluno.
 */
export function avaliarConquistas(
  definicoes: readonly DefinicaoDeConquista[],
  evidencia: EvidenciaDeConquista,
  jaDesbloqueadas: ReadonlySet<string>,
): readonly ConquistaADesbloquear[] {
  return definicoes
    .filter(
      (definicao) =>
        definicao.criterionKind === 'SESSOES_ACUMULADAS' &&
        !jaDesbloqueadas.has(definicao.id) &&
        evidencia.sessoesAcumuladas >= definicao.threshold,
    )
    .sort((a, b) => a.threshold - b.threshold)
    .map((definicao) => ({ definicao, evidenceEntryId: evidencia.ultimoMovimentoId }));
}
