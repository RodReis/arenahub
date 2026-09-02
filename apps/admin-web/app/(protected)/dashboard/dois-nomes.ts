/**
 * Primeiro e segundo nome — "Marina Chaves Oliveira" vira "Marina Chaves".
 *
 * ## Por que não é `abreviarNome`
 *
 * O `abreviarNome` do módulo de engajamento produz "Marina C." e existe para
 * TELA PÚBLICA (totem e app), onde o sobrenome inteiro é exposição de dado de
 * quem não escolheu aparecer. Aqui é tela interna: a recepção precisa
 * reconhecer a pessoa, e uma inicial não distingue "Marina Chaves" de "Marina
 * Costa" — que é exatamente o caso que faz alguém liberar o aluno errado.
 *
 * ## Por que dois e não o nome inteiro
 *
 * A lista mora numa coluna de 330 px ao lado do feed. Nome inteiro trunca com
 * reticências no meio do sobrenome, e "Bruna Barbara Militao Vi…" é pior que
 * "Bruna Barbara": o corte esconde justamente o que diferencia.
 *
 * Partícula (`de`, `da`, `dos`) não conta como segundo nome: "Ana de Souza"
 * viraria "Ana de", que não identifica ninguém — pula para "Ana Souza".
 */

/** Partículas que não identificam ninguém sozinhas. */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'del', 'di', 'van', 'von']);

export function doisNomes(nomeCompleto: string): string {
  const termos = nomeCompleto.trim().split(/\s+/u).filter(Boolean);

  const primeiro = termos[0];

  if (primeiro === undefined) return '';

  const segundo = termos.slice(1).find((termo) => !PARTICULAS.has(termo.toLowerCase()));

  return segundo === undefined ? primeiro : `${primeiro} ${segundo}`;
}
