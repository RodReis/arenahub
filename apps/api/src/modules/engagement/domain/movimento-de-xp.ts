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

export type OrigemDeMovimento =
  | 'ATTENDANCE_SESSION'
  | 'MANUAL_ADJUSTMENT'
  | 'ASSESSMENT'
  | 'HEALTH_GOAL';

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

/** O que `concederPorEvento` precisa -- concessao disparada por um evento
 * de outbox (avaliacao publicada, meta atingida), sem sessao de treino. */
export interface EntradaDeConcessaoPorEvento {
  regra: VersaoDeRegra;
  sourceKind: OrigemDeMovimento;
  sourceId: string;
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

/**
 * O `AAAA-MM` imediatamente ANTERIOR a `mes` -- usado pelo job de fechamento
 * mensal do ranking (Emenda de 27/08/2026, ADR-047) para achar o mes que
 * acabou de fechar.
 *
 * Aritmetica de STRING, nao `Date`: `new Date('2026-09-01')` e interpretado
 * em UTC, e decrementar o mes por `setMonth` exigiria escolher um fuso so
 * para o calculo -- exatamente o problema que `mesLocal` ja resolve
 * corretamente lendo o fuso da UNIDADE. Aqui so falta subtrair 1 mes de um
 * `AAAA-MM` que ja veio local; nao ha fuso novo a decidir.
 */
export function mesAnterior(mes: string): string {
  const [anoTexto, mesTexto] = mes.split('-');
  const ano = Number(anoTexto);
  const numeroDoMes = Number(mesTexto);

  const dezembroDoAnoAnterior = numeroDoMes === 1;
  const anoResultado = dezembroDoAnoAnterior ? ano - 1 : ano;
  const mesResultado = dezembroDoAnoAnterior ? 12 : numeroDoMes - 1;

  return `${anoResultado}-${String(mesResultado).padStart(2, '0')}`;
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
 * Concessao disparada por evento de outbox -- F73. Mesma forma de
 * `concederPorSessao`, sem `sourceKind` fixo: `AssessmentPublished` grava
 * `ASSESSMENT`, `HealthGoalReached` grava `HEALTH_GOAL`. A idempotencia e a
 * mesma chave unica (`tenantId, studentId, sourceKind, sourceId,
 * ruleVersionId, type`) -- reprocessar o mesmo evento colide e vira
 * sucesso idempotente no service, igual `concederPorSessao`.
 */
export function concederPorEvento(entrada: EntradaDeConcessaoPorEvento): MovimentoDeXp {
  return {
    type: 'GRANT',
    points: entrada.regra.points,
    ruleVersionId: entrada.regra.id,
    sourceKind: entrada.sourceKind,
    sourceId: entrada.sourceId,
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
): MovimentoDeXp {
  if (motivo.trim().length === 0) {
    throw new Error('XP_MOTIVO_OBRIGATORIO');
  }

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

/** O que `ajustar` precisa para montar o movimento manual. */
export interface EntradaDeAjuste {
  pontos: number;
  motivo: string;
  /** Chave de idempotencia do painel -- vira o `sourceId` (Task 11). */
  idempotencyKey: string;
  /**
   * FK obrigatoria de `XpLedgerEntry.ruleVersionId` -- o catalogo v1 nao tem
   * gatilho MANUAL, entao o ajuste referencia uma versao de regra qualquer
   * do tenant so para satisfazer a coluna. O motivo do movimento (o PORQUE)
   * vive em `reason`, nunca nesta referencia.
   */
  ruleVersionId: string;
  agora: Date;
  fusoDaUnidade: string;
}

/**
 * Movimento manual (painel) -- ajuste de XP fora do catalogo automatico,
 * `M5-FR-007`/`M5-AC-010`.
 *
 * NAO EXISTE "editar": isto e sempre um INSERT novo. `idempotencyKey` e o
 * `sourceId` -- a chave unica do ledger (`tenantId, studentId, sourceKind,
 * sourceId, ruleVersionId, type`) e quem impede duplicar o mesmo ajuste, nao
 * uma checagem previa em memoria.
 */
export function ajustar(entrada: EntradaDeAjuste): MovimentoDeXp {
  const motivo = entrada.motivo.trim();
  if (motivo.length === 0) {
    throw new Error('XP_MOTIVO_OBRIGATORIO');
  }

  return {
    type: 'ADJUSTMENT',
    points: entrada.pontos,
    ruleVersionId: entrada.ruleVersionId,
    sourceKind: 'MANUAL_ADJUSTMENT',
    sourceId: entrada.idempotencyKey,
    reversesEntryId: null,
    occurredAt: entrada.agora,
    localMonth: mesLocal(entrada.agora, entrada.fusoDaUnidade),
    reason: motivo,
  };
}

/** O saldo E a soma do ledger. Nao ha outra definicao. */
export function somarSaldo(movimentos: readonly { points: number }[]): number {
  return movimentos.reduce((total, movimento) => total + movimento.points, 0);
}
