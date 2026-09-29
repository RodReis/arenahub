import {
  Money,
  PainelDeEstado,
  StateBadge,
  TenantDateTime,
  type IconName,
  type TomDeEstado,
} from '@arenahub/ui';

import { diasDeAtraso } from '../../../../../src/billing/vencimento';
import estilos from './situacao-atual.module.css';

interface InvoiceEmDestaque {
  readonly id: string;
  readonly number: number;
  readonly status: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly dueAt: string;
}

interface Props {
  /** A invoice OPEN ou OVERDUE mais antiga -- a que a recepcao precisa resolver agora. */
  readonly invoice: InvoiceEmDestaque | null;
  readonly timezone: string;
  readonly agora: Date;
}

/**
 * O que o aluno deve AGORA -- topo da pagina, F53 Task 10.
 *
 * A CENA REAL: a recepcionista abre a ficha com a pessoa na frente e precisa
 * ver, sem procurar, se ha algo em aberto. Antes disso a tela ia direto para
 * a tabela historica inteira -- a fatura do mes corrente ficava perdida
 * entre as pagas.
 *
 * O PAINEL CARREGA O TOM do que mede (`PainelDeEstado`, DS-PAINEL §4.6):
 * vencida pinta `danger` em intensidade de alerta, em aberto pinta `warning`,
 * nada em aberto pinta `success` em repouso. A cor nunca decide sozinha --
 * o rotulo, o `StateBadge` e a contagem de atraso dizem o mesmo por escrito.
 */
export function SituacaoAtual({ invoice, timezone, agora }: Props) {
  if (!invoice) {
    return (
      <PainelDeEstado
        rotulo="Situação atual"
        tom="success"
        icone="check-circle"
        testId="sem-pendencia"
      >
        <span className={estilos['semPendencia']}>Nenhuma cobrança em aberto</span>
      </PainelDeEstado>
    );
  }

  /*
   * `diasDeAtraso` do modulo de vencimento, e nao uma conta local: ele compara
   * DIA CIVIL no fuso da unidade. Subtrair instantes -- o que esta tela fazia
   * antes -- marca atraso de um dia as 00:01 do proprio vencimento, e faz o
   * numero aqui discordar da faixa que a ficha do aluno mostra.
   */
  const estaVencida = invoice.status === 'OVERDUE';
  const atraso = estaVencida ? diasDeAtraso(invoice, agora, timezone) : 0;

  /*
   * VENCIDA E ALERTA, EM ABERTO NAO E. As duas intensidades do painel existem
   * para isto: se toda cobranca em aberto pintasse o fundo inteiro, a que
   * realmente venceu nao teria como gritar mais alto. A fatura do mes corrente
   * e o caso NORMAL do balcao -- ela informa, nao alarma.
   */
  const tom: TomDeEstado = estaVencida ? 'danger' : 'warning';
  const icone: IconName = estaVencida ? 'alert-triangle' : 'clock';

  return (
    <PainelDeEstado
      rotulo="Situação atual"
      tom={tom}
      icone={icone}
      emAlerta={estaVencida}
      testId="invoice-em-destaque"
      apoio={
        <>
          <span>
            Cobrança nº <span className={estilos['numero']}>{invoice.number}</span> · vence em{' '}
            <TenantDateTime iso={invoice.dueAt} timeZone={timezone} format="date" />
          </span>
          {/*
            `<strong>` e nao `<span>`: o design system pinta o tom cheio no
            `<strong>` do apoio, e a enfase semantica e verdadeira -- a
            contagem de atraso e a informacao mais forte da linha.
          */}
          {atraso > 0 ? (
            <strong data-testid="dias-de-atraso">
              {atraso} {atraso === 1 ? 'dia' : 'dias'} de atraso
            </strong>
          ) : null}
        </>
      }
    >
      <Money cents={invoice.totalMinor} currency={invoice.currency} />
      <StateBadge machine="invoice" state={invoice.status} />
    </PainelDeEstado>
  );
}
