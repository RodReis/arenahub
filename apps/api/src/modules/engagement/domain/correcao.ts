/**
 * Teto da correcao manual de XP.
 *
 * RECUSA, NAO APROVA (ADR-049, Decisao 2). Acima do teto a operacao e barrada
 * com erro de dominio; nao ha fila de aprovacao e nao ha segundo ator.
 *
 * O precedente esta escrito no schema, em `BillingSettings.refundLimitMinor`:
 * "nao existe papel de aprovador, e inventar uma fila de aprovacao que
 * ninguem opera produziria estorno travado para sempre". A academia inaugural
 * tem UMA secretaria -- uma fila que exige dois operadores distintos nunca
 * anda, e correcao travada para sempre e pior que correcao errada, porque a
 * errada aparece no extrato e este mesmo mecanismo a reverte.
 *
 * Pura: sem banco, sem relogio, sem rede.
 */

/** Teto ausente. `null` e "esta academia nao configurou limite". */
export const TETO_ILIMITADO = null;

export interface EntradaDeAutorizacao {
  /** Pontos da correcao. Positivo devolve, negativo retira. */
  pontos: number;
  /** Teto por operacao, em pontos ABSOLUTOS. `null` = sem teto. */
  teto: number | null;
}

export function autorizarCorrecao(entrada: EntradaDeAutorizacao): void {
  if (!Number.isInteger(entrada.pontos)) {
    throw new Error('CORRECAO_NAO_INTEIRA');
  }

  // Movimento de zero gravaria linha num ledger append-only que nao muda
  // saldo nenhum -- e append-only significa que ela nunca sai de la.
  if (entrada.pontos === 0) {
    throw new Error('CORRECAO_SEM_EFEITO');
  }

  if (entrada.teto === TETO_ILIMITADO) {
    return;
  }

  // VALOR ABSOLUTO, e este e o ponto perigoso da funcao. Comparar
  // `pontos > teto` cru deixaria toda correcao negativa passar por qualquer
  // teto, porque -5000 > 100 e falso: zerar o saldo de um aluno seria a
  // operacao MENOS controlada do sistema. Tirar 500 e tao grave quanto dar.
  if (Math.abs(entrada.pontos) > entrada.teto) {
    throw new Error('CORRECAO_ACIMA_DO_TETO');
  }
}
