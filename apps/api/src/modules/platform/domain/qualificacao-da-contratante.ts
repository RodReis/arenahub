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

/** Rotulo do campo faltando, na ordem em que aparece no cadastro. */
export function camposFaltandoParaContrato(tenant: DadosMinimosDeTenant): string[] {
  const faltando: string[] = [];

  if (!tenant.cnpj) faltando.push('CNPJ');
  if (!tenant.addressLine || !tenant.addressCity || !tenant.addressState) {
    faltando.push('endereço');
  }
  if (!tenant.responsavelNome) faltando.push('nome do responsável');
  if (!tenant.responsavelCpf) faltando.push('CPF do responsável');

  return faltando;
}
