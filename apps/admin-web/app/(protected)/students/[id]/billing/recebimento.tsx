import { Icon, TenantDateTime } from '@arenahub/ui';

import { FORMAS } from './seletor-de-forma';
import estilos from './recebimento.module.css';

export interface PagamentoRecebido {
  readonly id: string;
  readonly method: string;
  readonly paidAt: string | null;
  readonly receivedVia: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO' | null;
}

/**
 * Um recebimento na coluna da grid: canal com a cor e o glifo do seletor
 * (`--ah-channel-*`, DS-PAINEL §2.3b) e a data embaixo.
 *
 * Pagamento anterior ao registro de canal (`receivedVia` nulo) cai no rotulo
 * do metodo, sem cor -- nao ha canal para identificar.
 */
export function Recebimento({ pagamento, timezone }: { readonly pagamento: PagamentoRecebido; readonly timezone: string }) {
  const forma = FORMAS.find((f) => f.forma === pagamento.receivedVia);
  const rotulo = forma ? forma.rotulo : pagamento.method === 'MANUAL' ? 'Dinheiro' : pagamento.method;

  return (
    <span className={estilos['recebimento']}>
      <span className={estilos['canal']} {...(forma ? { 'data-canal': forma.canal } : {})}>
        <Icon name={forma?.icone ?? 'check-circle'} />
        {rotulo}
      </span>
      {pagamento.paidAt ? (
        <span className={estilos['quando']}>
          <TenantDateTime iso={pagamento.paidAt} timeZone={timezone} format="datetime" />
        </span>
      ) : null}
    </span>
  );
}
