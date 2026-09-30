export interface MesPagavelUI {
  readonly competencia: string; // 'YYYY-MM'
  readonly status: 'OVERDUE' | 'OPEN' | 'NOT_OPENED';
  readonly invoiceId: string | null;
  readonly totalMinor: number;
  readonly dueAt: string;
}

/**
 * Prefixo continuo da faixa ate a competencia clicada -- mesma regra do
 * `resolverLote` do backend (F83), replicada aqui so para feedback visual
 * instantaneo no clique. O servidor SEMPRE recalcula e e a fonte de
 * verdade; este helper nunca decide o que e cobrado.
 */
export function selecionarAte(faixa: readonly MesPagavelUI[], competenciaClicada: string): MesPagavelUI[] {
  const indice = faixa.findIndex((m) => m.competencia === competenciaClicada);

  if (indice === -1) {
    return [];
  }

  return faixa.slice(0, indice + 1);
}
