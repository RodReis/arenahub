/**
 * Normalizacao e validacao de endereco do aluno.
 *
 * Funcoes puras, pelo mesmo motivo de `identificacao.ts`: sem banco, sem
 * rede, sem relogio (`CLAUDE.md`, Convencoes de codigo).
 *
 * A tabela `student_addresses` existe desde a F7 e nunca foi escrita por
 * nada. A F45 passa a escreve-la -- e o que entra ali tem de estar
 * normalizado na entrada, porque corrigir depois exige saber qual das
 * formas ("80010-000", "80010000", "80.010-000") era a certa.
 */

/**
 * CEP reduzido a oito digitos, ou `null` se nao for um CEP.
 *
 * `null` em vez de gravar o que veio: CEP com sete digitos e erro de
 * digitacao, e aceita-lo faz a correspondencia com qualquer base de
 * logradouro falhar em silencio, meses depois, sem ninguem saber por que.
 */
export function normalizarCep(valor: string): string | null {
  const digitos = valor.replace(/\D/g, '');

  return digitos.length === 8 ? digitos : null;
}

/**
 * As 27 unidades federativas.
 *
 * Lista fechada, e nao `/^[A-Z]{2}$/`: a regex aceita "XX", que nao existe
 * e entra no banco sem reclamar. Esta lista nao muda desde 1988 -- criar
 * tabela para ela seria um JOIN por endereco exibido, em troca de nada.
 */
const UNIDADES_FEDERATIVAS: ReadonlySet<string> = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

/** A sigla e uma UF de verdade? Aceita qualquer caixa. */
export function ufEhValida(valor: string): boolean {
  return UNIDADES_FEDERATIVAS.has(valor.trim().toUpperCase());
}
