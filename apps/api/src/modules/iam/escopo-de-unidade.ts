import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

/**
 * Quem esta amarrado a unidades nao entrega acesso maior do que o proprio --
 * #597.
 *
 * `UserRole.gymUnitId` nulo vale no tenant INTEIRO (`AuthGuard`). Sem esta
 * guarda, um gerente de uma unidade convidava um e-mail com o mesmo papel SEM
 * unidade, e o convidado operava a academia toda.
 */
export class EscopoDeUnidadeInsuficienteError extends ErroDeDominio {
  constructor() {
    super(
      'UNIT_SCOPE_FORBIDDEN',
      403,
      'Voce so pode conceder ou revogar acesso nas unidades em que voce atua',
    );
  }
}

/** `gymUnitId` nulo e o tenant inteiro: so quem tem escopo ALL concede ou revoga isso. */
export function unidadeCabeNoEscopo(
  contexto: Pick<TenantContext, 'allowedUnitIds'>,
  gymUnitId: string | null | undefined,
): boolean {
  if (contexto.allowedUnitIds === 'ALL') return true;

  return typeof gymUnitId === 'string' && contexto.allowedUnitIds.has(gymUnitId);
}
