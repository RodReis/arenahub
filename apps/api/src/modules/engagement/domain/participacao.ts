/**
 * Regime de participacao no engajamento -- OPT-OUT.
 *
 * ATENCAO, e aqui que se erra: ausencia de linha significa PARTICIPA, o
 * OPOSTO de `avaliarConsentimento` em `modules/privacy` (biometria), onde
 * ausencia significa NAO AUTORIZADO.
 *
 * NAO unifique os dois predicados. A diferenca e de REGIME, nao de
 * implementacao: o PI decidiu em 26/08/2026 que os alunos ja estao aceitos
 * e autorizados no ranking, e quem nao quiser aparecer pede para sair
 * (ADR-046). Um predicado servindo aos dois regimes passa verde enquanto
 * nenhum teste misturar os casos -- e ai a academia some do ranking, ou
 * pior, um aluno que pediu para sair reaparece.
 */

/** Finalidades de engajamento. `CHALLENGE` e `ENGAGEMENT_PUSH` nascem
 * DORMENTES: modeladas para que F31-F35 nao precisem de migration, sem
 * consumidor nesta fatia. */
export type FinalidadeDeEngajamento =
  | 'RANKING'
  | 'CHALLENGE'
  | 'ENGAGEMENT_PUSH'
  | 'PHYSICAL_EVOLUTION_RANKING';

/** O que a regra precisa saber sobre a decisao ja registrada. */
export interface DecisaoDeEngajamento {
  decision: 'ACCEPTED' | 'REFUSED';
  /** Preenchido quando uma decisao posterior substituiu esta. */
  supersededAt: Date | null;
}

/**
 * O aluno participa do ranking AGORA?
 *
 * `null` = participa: nunca houve manifestacao, e o padrao e participar.
 * Decisao substituida tambem: e historico, nao estado atual.
 */
export function participaDoRanking(decisao: DecisaoDeEngajamento | null): boolean {
  if (!decisao) return true;
  if (decisao.supersededAt !== null) return true;

  return decisao.decision === 'ACCEPTED';
}
