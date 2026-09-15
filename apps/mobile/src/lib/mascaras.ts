/**
 * Mascaras de entrada do app do aluno -- CPF e data de nascimento.
 *
 * Mesma regra do painel (`apps/admin-web/src/lib/mascaras.ts`, CLAUDE.md:
 * "mascaras/validacao nos campos"): formatar so o que ja foi digitado. Nao
 * importa do painel porque sao apps separados, sem pacote compartilhado para
 * duas funcoes puras -- duplicar a regra aqui custa menos que criar um
 * pacote novo so para isto.
 */

/** So os digitos, cortados no comprimento maximo. */
function digitos(valor: string, maximo: number): string {
  return valor.replace(/\D/g, '').slice(0, maximo);
}

/** `111.444.777-35`, formatado conforme se digita -- usado no CPF de login. */
export function mascararCpf(valor: string): string {
  const d = digitos(valor, 11);

  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;

  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** `10/05/2000`, formatado conforme se digita -- usado na data de nascimento. */
export function mascararDataNascimento(valor: string): string {
  const d = digitos(valor, 8);

  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;

  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/**
 * `10/05/2000` -> `2000-05-10`, para o corpo da requisicao. `null` enquanto
 * a data nao estiver completa -- o chamador usa isto para so liberar o envio
 * com os 8 digitos preenchidos.
 */
export function dataNascimentoParaIso(mascarada: string): string | null {
  const d = digitos(mascarada, 8);
  if (d.length !== 8) return null;

  return `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
}
