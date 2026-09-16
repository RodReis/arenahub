/**
 * Gatilhos de prazo dos eventos de notificacao que nascem de tempo
 * passando, nao de mutacao -- F73 §4.2.
 *
 * PURAS: sem banco, sem relogio proprio. `agora` entra por parametro.
 */

const UM_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * A invoice vence em exatamente `dias` dias a partir de `agora`?
 *
 * Comparacao por DIA, arredondando para baixo -- um `dueAt` as 23h59 e um
 * `agora` as 00h01 do mesmo dia D-3 ainda contam como "faltam 3 dias", sem
 * depender do horario exato em que o job roda.
 */
export function estaNoLimiarDeVencimento(dueAt: Date, agora: Date, dias: number): boolean {
  const diferencaEmDias = Math.floor((dueAt.getTime() - agora.getTime()) / UM_DIA_MS);

  return diferencaEmDias === dias;
}

/** Decisao do PI, 16/09/2026: 7 dias corridos sem check-in. */
const LIMIAR_DE_AUSENCIA_EM_DIAS = 7;

export function estaAusenteHaSeteDias(ultimoCheckIn: Date, agora: Date): boolean {
  const diasSemCheckIn = Math.floor((agora.getTime() - ultimoCheckIn.getTime()) / UM_DIA_MS);

  return diasSemCheckIn >= LIMIAR_DE_AUSENCIA_EM_DIAS;
}
