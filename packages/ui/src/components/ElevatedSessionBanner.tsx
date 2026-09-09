import type { ReactNode } from 'react';

import { TenantDateTime } from './TenantDateTime.js';
import estilos from './ElevatedSessionBanner.module.css';

interface Props {
  readonly tenant: string;
  readonly reason: string;
  readonly expiresAt: string;
  readonly timeZone: string;
  /**
   * Saida da elevacao -- DS-PAINEL.md §4.2 pede o botao "Encerrar".
   *
   * SLOT e nao `onSair`: quem sai de uma elevacao sai por Server Action num
   * `<form action>`, e o `packages/ui` nao importa nada do `admin-web`. Passar
   * um callback obrigaria a faixa a virar Client Component so para repassar um
   * clique.
   *
   * OPCIONAL: sem ele a faixa segue existindo e avisando. Um erro na tela que
   * monta o botao nao pode apagar o aviso -- faixa ausente e o defeito grave,
   * botao ausente e so incomodo.
   */
  readonly sair?: ReactNode;
}

/**
 * Faixa PERSISTENTE de sessao elevada -- DS-PAINEL.md §4.2 e §5.
 *
 * AVISO DE SEGURANCA, nao enfeite: quem opera elevado ve a tela do cliente
 * identica a propria, e sem a faixa age achando que esta na propria casa. Por
 * isso ela fica acima de tudo no `AppShell` e nao tem como dispensar.
 *
 * Nao ha prop `onDismiss`, e a ausencia e a garantia. "Encerrar" e coisa
 * diferente de "fechar o aviso": um sai do tenant, o outro so esconderia que
 * se esta nele.
 */
export function ElevatedSessionBanner({ tenant, reason, expiresAt, timeZone, sair }: Props) {
  return (
    <div className={estilos['faixa']} role="status" data-testid="faixa-de-suporte">
      <span className={estilos['texto']}>
        Você está operando como <strong>suporte</strong> em {tenant} · {reason} · encerra às{' '}
        <TenantDateTime iso={expiresAt} timeZone={timeZone} format="time" />
      </span>

      {sair ? <span className={estilos['acao']}>{sair}</span> : null}
    </div>
  );
}
