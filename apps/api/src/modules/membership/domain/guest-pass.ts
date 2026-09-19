/**
 * Passe de convidado (F76, ADR-060): limite mensal por assinatura.
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). O "agora" entra por
 * parametro.
 */

/**
 * Reduz um instante ao inicio do mes-calendario que o contem, em UTC.
 *
 * DECISAO DO PI (18/09/2026): reset e por MES-CALENDARIO, nao por ciclo de
 * cobranca da assinatura -- todo aluno reseta no mesmo dia 1, independente
 * de quando a assinatura dele renova.
 */
export function competenciaMensalDe(instante: Date): Date {
  return new Date(Date.UTC(instante.getUTCFullYear(), instante.getUTCMonth(), 1));
}

/** `usos` ja alcancou ou ultrapassou `limite`. */
export function limiteDeConvidadosExcedido(usos: number, limite: number): boolean {
  return usos >= limite;
}
