import { TenantDateTime } from './TenantDateTime.js';
import estilos from './ElevatedSessionBanner.module.css';

interface Props {
  readonly tenant: string;
  readonly reason: string;
  readonly expiresAt: string;
  readonly timeZone: string;
}

/**
 * Faixa PERSISTENTE de sessao elevada -- DS-PAINEL.md §5.
 *
 * Nao e dispensavel, de proposito: o operador precisa ver que esta elevado o
 * tempo TODO. Um banner que se fecha some da memoria em trinta segundos, e ai
 * alguem opera como Super Admin sobre o tenant do cliente achando que e
 * usuario comum.
 *
 * Nao ha prop `onDismiss`. A ausencia e a garantia.
 */
export function ElevatedSessionBanner({ tenant, reason, expiresAt, timeZone }: Props) {
  return (
    <div className={estilos['faixa']} role="status">
      <strong>Sessão elevada</strong> · {tenant} · {reason} · expira às{' '}
      <TenantDateTime iso={expiresAt} timeZone={timeZone} format="time" />
    </div>
  );
}
