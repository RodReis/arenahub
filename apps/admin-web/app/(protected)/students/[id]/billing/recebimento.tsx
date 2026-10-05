import { Icon } from '@arenahub/ui';

import { FORMAS } from './seletor-de-forma';
import estilos from './recebimento.module.css';

export interface PagamentoRecebido {
  readonly method: string;
  readonly receivedVia: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO' | null;
}

/**
 * O selo do canal na coluna FORMA da grade -- Dinheiro, PIX, Débito, Crédito.
 *
 * Emenda de 05/10/2026 (decisão do PI): a cor de cada canal ficou mais
 * distante da dos outros (`--ah-channel-*`, DS-PAINEL §2.3b) e o glifo passou
 * a morar num disco cheio da cor do canal, com o rótulo na mesma cor. Quem
 * olha a grade reconhece o canal pela forma e pela cor antes de ler, e o
 * rótulo continua dizendo -- cor nunca é canal único.
 *
 * A data do recebimento saiu daqui e virou coluna própria ("Pago em"): na
 * mesma célula, selos de largura diferente ("PIX" x "Dinheiro") empurravam a
 * data e nenhuma linha alinhava com a de baixo.
 *
 * Pagamento anterior ao registro de canal (`receivedVia` nulo) cai no rótulo
 * do método, sem cor -- não há canal para identificar.
 */
export function SeloDoCanal({ pagamento }: { readonly pagamento: PagamentoRecebido }) {
  const forma = FORMAS.find((f) => f.forma === pagamento.receivedVia);
  const rotulo = forma ? forma.rotulo : pagamento.method === 'MANUAL' ? 'Dinheiro' : pagamento.method;

  return (
    <span className={estilos['selo']} {...(forma ? { 'data-canal': forma.canal } : {})}>
      <span className={estilos['disco']} aria-hidden="true">
        <Icon name={forma?.icone ?? 'check-circle'} />
      </span>
      {rotulo}
    </span>
  );
}
