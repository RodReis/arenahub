/**
 * Confere se o tenant tem o minimo para qualificar a CONTRATANTE no contrato
 * -- F70 (SPEC-070 §6, §8 invariante 4).
 *
 * FUNCAO PURA: sem banco, sem storage. `tenant-contract.use-case.ts` chama
 * antes de gerar o PDF e recusa a ativacao (422) se faltar algo, em vez do
 * comportamento anterior de imprimir "não informado" e seguir.
 */

export interface DadosMinimosDeTenant {
  readonly legalName: string;
  readonly cnpj: string | null;
  readonly addressLine: string | null;
  readonly addressCity: string | null;
  readonly addressState: string | null;
  readonly responsavelNome: string | null;
  readonly responsavelCpf: string | null;
}

/**
 * Preenchido de verdade -- `null`, `''` e `'   '` sao a mesma coisa aqui.
 *
 * O `.trim()` NAO e zelo: o PATCH de tenant valida com `.min(1)` DEPOIS do
 * `.trim()` do Zod, mas a coluna e opcional e nasceu nula em producao, e nada
 * impede uma importacao ou um `psql` gravar espaco. Sem o corte, um CNPJ
 * `'   '` passaria na checagem e sairia impresso como espaco em branco no
 * contrato -- pior que o "não informado" que esta fatia veio remover, porque
 * nao se ve.
 */
function preenchido(valor: string | null): boolean {
  return valor !== null && valor.trim().length > 0;
}

/** Rotulo do campo faltando, na ordem em que aparece no cadastro. */
export function camposFaltandoParaContrato(tenant: DadosMinimosDeTenant): string[] {
  const faltando: string[] = [];

  if (!preenchido(tenant.cnpj)) faltando.push('CNPJ');
  if (
    !preenchido(tenant.addressLine) ||
    !preenchido(tenant.addressCity) ||
    !preenchido(tenant.addressState)
  ) {
    faltando.push('endereço');
  }
  if (!preenchido(tenant.responsavelNome)) faltando.push('nome do responsável');
  if (!preenchido(tenant.responsavelCpf)) faltando.push('CPF do responsável');

  return faltando;
}
