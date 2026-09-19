/**
 * "Aulas inclusas" no plano -- F78 (SPEC-078, ADR-061, ADR-062).
 *
 * Funcao pura: sem banco. LISTA VAZIA AUTORIZA TUDO -- mesma regra do
 * `DEFAULT true` da F69: plano sem nenhum `PlanClassEntitlement` cadastrado
 * nao restringe nada.
 */
export function modalidadeAutorizada(
  modalidadesDoPlano: readonly string[],
  modalityId: string,
): boolean {
  if (modalidadesDoPlano.length === 0) return true;

  return modalidadesDoPlano.includes(modalityId);
}
