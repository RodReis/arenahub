import type { VersaoDeRegra } from './regra-de-xp.js';

/**
 * Movimentos do ledger de XP.
 *
 * PURO: sem banco, sem relogio. O "agora" da reversao entra por parametro.
 *
 * O ledger e APPEND-ONLY, e isso muda a forma das funcoes aqui: nao ha
 * `atualizarPontos`. Corrigir e CRIAR um movimento compensatorio que
 * aponta para o original -- `M5-FR-007` e a mesma disciplina que
 * `AccessEventCorrection` ja aplica no MVP 1.
 */

export type TipoDeMovimento = 'GRANT' | 'ADJUSTMENT' | 'REVERSAL';

export type OrigemDeMovimento = 'ATTENDANCE_SESSION' | 'MANUAL_ADJUSTMENT';

export interface MovimentoDeXp {
  type: TipoDeMovimento;
  points: number;
  ruleVersionId: string;
  sourceKind: OrigemDeMovimento;
  sourceId: string;
  reversesEntryId: string | null;
  occurredAt: Date;
  localMonth: string;
  reason: string | null;
}

/** O que `reverter` precisa saber do movimento original. */
export interface MovimentoOriginal {
  id: string;
  points: number;
  ruleVersionId: string;
  sourceKind: OrigemDeMovimento;
  sourceId: string;
  occurredAt: Date;
  localMonth: string;
}

export interface EntradaDeConcessao {
  regra: VersaoDeRegra;
  sessionId: string;
  occurredAt: Date;
  fusoDaUnidade: string;
}

/**
 * `AAAA-MM` do instante, no fuso DA UNIDADE.
 *
 * O fuso entra por parametro e nao sai de `process.env` nem do relogio do
 * servidor: a mesma API serve unidades em fusos diferentes, e um treino as
 * 21h em Manaus nao pertence ao mesmo mes que um treino as 21h em Recife
 * quando o mes vira.
 *
 * `en-CA` produz `AAAA-MM-DD`, que corta em 7 caracteres sem depender de
 * ordem de campo -- diferente de montar a string a partir de
 * `getMonth() + 1`, que exige preencher zero a mao e erra na virada do ano
 * se alguem trocar a ordem.
 */
export function mesLocal(quando: Date, fusoDaUnidade: string): string {
  const formatador = new Intl.DateTimeFormat('en-CA', {
    timeZone: fusoDaUnidade,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatador.format(quando).slice(0, 7);
}

/** Concessao por sessao de treino confirmada. */
export function concederPorSessao(entrada: EntradaDeConcessao): MovimentoDeXp {
  return {
    type: 'GRANT',
    points: entrada.regra.points,
    ruleVersionId: entrada.regra.id,
    sourceKind: 'ATTENDANCE_SESSION',
    sourceId: entrada.sessionId,
    reversesEntryId: null,
    occurredAt: entrada.occurredAt,
    localMonth: mesLocal(entrada.occurredAt, entrada.fusoDaUnidade),
    reason: null,
  };
}

/**
 * Movimento compensatorio.
 *
 * `localMonth` e `occurredAt` sao os DO FATO ORIGINAL, nao os da correcao.
 * Estornar em setembro um ponto concedido em agosto deixaria agosto com um
 * ponto que ja nao vale -- e o placar de agosto, que e imutavel, passaria a
 * discordar do ledger que o originou.
 */
export function reverter(
  original: MovimentoOriginal,
  motivo: string,
  agora: Date,
): MovimentoDeXp {
  if (motivo.trim().length === 0) {
    throw new Error('XP_MOTIVO_OBRIGATORIO');
  }

  void agora;

  return {
    type: 'REVERSAL',
    points: -original.points,
    ruleVersionId: original.ruleVersionId,
    sourceKind: original.sourceKind,
    sourceId: original.sourceId,
    reversesEntryId: original.id,
    occurredAt: original.occurredAt,
    localMonth: original.localMonth,
    reason: motivo.trim(),
  };
}

/** O saldo E a soma do ledger. Nao ha outra definicao. */
export function somarSaldo(movimentos: readonly { points: number }[]): number {
  return movimentos.reduce((total, movimento) => total + movimento.points, 0);
}
