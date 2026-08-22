/**
 * Leitura de um valor contra a faixa do fabricante (spec §6).
 *
 * Funções puras. Mora no SERVIDOR de propósito: se cada superfície
 * calculasse a sua, o aluno veria o braço verde no celular e amarelo no
 * totem no dia em que uma faixa mudasse.
 */

export type Leitura = 'BELOW' | 'WITHIN' | 'ABOVE' | 'AT_LIMIT' | 'UNKNOWN';

/** Faixa do padrão em percentual: 90% a 110% é o intervalo dos laudos. */
const PERCENTUAL_MIN = 90;
const PERCENTUAL_MAX = 110;

export function lerFaixa(valor: number | null, min: number | null, max: number | null): Leitura {
  // INV-104: sem valor ou sem faixa não há leitura — e "UNKNOWN" não é
  // "WITHIN". Assumir dentro esconderia ausência de dado atrás de um
  // rótulo tranquilizador.
  if (valor === null) return 'UNKNOWN';
  if (min === null && max === null) return 'UNKNOWN';

  if (min !== null && valor < min) return 'BELOW';
  if (max !== null && valor > max) return 'ABOVE';
  if ((min !== null && valor === min) || (max !== null && valor === max)) return 'AT_LIMIT';

  return 'WITHIN';
}

export function leituraDoPercentual(percentual: number | null): Leitura {
  return lerFaixa(percentual, PERCENTUAL_MIN, PERCENTUAL_MAX);
}
