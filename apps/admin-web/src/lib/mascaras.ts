/**
 * Máscaras de entrada do painel — CPF, CEP e telefone.
 *
 * Exigidas pelo `CLAUDE.md` (Convenções de código: "máscaras/validação nos
 * campos"). Funções puras: recebem o que foi digitado, devolvem o que deve
 * aparecer. Sem DOM, sem React, sem estado.
 *
 * A regra que todas seguem: **formatar apenas o que já foi digitado**.
 * Máscara que se adianta — mostrando `(  )` antes do DDD, ou `.` antes do
 * quarto dígito — apaga o caractere que a pessoa acabou de escrever e torna
 * o campo impossível de preencher.
 */

/** Só os dígitos, cortados no comprimento máximo do documento. */
function digitos(valor: string, maximo: number): string {
  return valor.replace(/\D/g, '').slice(0, maximo);
}

/** `111.444.777-35`, formatado conforme se digita. */
export function mascararCpf(valor: string): string {
  const d = digitos(valor, 11);

  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;

  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** `80010-000`, formatado conforme se digita. */
export function mascararCep(valor: string): string {
  const d = digitos(valor, 8);

  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

/**
 * `(41) 99999-0000` para celular, `(41) 3333-0000` para fixo.
 *
 * O corte do hífen depende do total: com onze dígitos ele cai depois do
 * quinto; com dez, depois do quarto. Um formato só deixaria o telefone fixo
 * com um dígito do lado errado do hífen.
 */
export function mascararTelefone(valor: string): string {
  const d = digitos(valor, 11);

  if (d.length <= 2) return d.length === 0 ? '' : `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;

  const corte = d.length > 10 ? 7 : 6;

  return `(${d.slice(0, 2)}) ${d.slice(2, corte)}-${d.slice(corte)}`;
}
