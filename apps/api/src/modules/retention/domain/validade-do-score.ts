/**
 * A idade de um score, e o que fazer com ela (F37, `M6-BR-009`).
 *
 * PURO: o "agora" entra por parametro. Score envelhece com o relogio, e teste
 * que le `new Date()` internamente envelhece junto -- foi assim que a suite da
 * `main` ficou vermelha sozinha em 31/08 (F36, issue #223).
 *
 * ---------------------------------------------------------------------------
 * SINALIZAR, NAO SILENCIAR
 * ---------------------------------------------------------------------------
 *
 * `M6-BR-009`: "falha do pipeline preserva ultimo score com marca de idade; nao
 * o apresenta como atual indefinidamente". As duas metades importam.
 *
 * Apagar o score quando o pipeline falha deixa a recepcao sem nada, e o
 * trabalho do dia para por causa de um job. Mostra-lo como se fosse de hoje e
 * pior: alguem liga para um aluno que voltou a treinar ontem, com um motivo que
 * ja nao vale. O meio-termo e a IDADE VISIVEL -- o score continua na tela,
 * dizendo quantos dias tem.
 *
 * `EXPIRADO` nao apaga nada: so para de participar de PRIORIZACAO nova. O
 * historico e append-only e a idade continua legivel.
 */

const MILISSEGUNDOS_POR_DIA = 86_400_000;

export type EstadoDeValidade = 'ATUAL' | 'DESATUALIZADO' | 'EXPIRADO';

export interface Validade {
  readonly estado: EstadoDeValidade;
  /** Dias inteiros desde o calculo. Sempre visivel, inclusive quando expirado. */
  readonly idadeEmDias: number;
}

export interface LimitesDeValidade {
  readonly desatualizadoEmDias: number;
  readonly expiradoEmDias: number;
}

/**
 * Um dia para desatualizar, sete para expirar.
 *
 * O pipeline e diario (`M6-NFR-001`), entao um score de ontem ja perdeu a
 * ultima rodada e merece a marca. Sete dias e o ponto em que a semana virou e
 * quase toda feature de frequencia mudou de significado.
 */
export const VALIDADE_PADRAO: LimitesDeValidade = {
  desatualizadoEmDias: 1,
  expiradoEmDias: 7,
};

export function validadeDoScore(
  calculadoEm: Date,
  agora: Date,
  limites: LimitesDeValidade = VALIDADE_PADRAO,
): Validade {
  // Relogio para tras (NTP, fuso mal aplicado) daria idade negativa, e idade
  // negativa faria um score do futuro parecer atual por sorte. Piso em zero.
  const idadeEmDias = Math.max(
    0,
    Math.floor((agora.getTime() - calculadoEm.getTime()) / MILISSEGUNDOS_POR_DIA),
  );

  if (idadeEmDias >= limites.expiradoEmDias) {
    return { estado: 'EXPIRADO', idadeEmDias };
  }
  if (idadeEmDias >= limites.desatualizadoEmDias) {
    return { estado: 'DESATUALIZADO', idadeEmDias };
  }
  return { estado: 'ATUAL', idadeEmDias };
}
