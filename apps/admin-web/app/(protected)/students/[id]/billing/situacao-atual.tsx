import { Money, StateBadge, TenantDateTime } from '@arenahub/ui';

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
 * Dias corridos entre `dueAt` e `agora`, no calendario -- nao no instante.
 *
 * Comparar instante contra instante marcaria a fatura como vencida minutos
 * apos a meia-noite do proprio dia de vencimento, que ainda nao venceu. A
 * conta aqui e deliberadamente simples (diferenca de dias corridos, sem o
 * fuso da unidade): o calculo COM fuso -- `situacaoDeVencimento` -- e a
 * Task 12, fora do escopo desta tela.
 */
function diasDeAtraso(dueAt: string, agora: Date): number {
  const vencimento = new Date(dueAt);
  const diferencaEmMs = agora.getTime() - vencimento.getTime();
  const dias = Math.floor(diferencaEmMs / (1000 * 60 * 60 * 24));

  return dias > 0 ? dias : 0;
}

/**
 * O que o aluno deve AGORA -- topo da pagina, F53 Task 10.
 *
 * A CENA REAL: a recepcionista abre a ficha com a pessoa na frente e precisa
 * ver, sem procurar, se ha algo em aberto. Antes disso a tela ia direto para
 * a tabela historica inteira -- a fatura do mes corrente ficava perdida
 * entre as pagas.
 */
export function SituacaoAtual({ invoice, timezone, agora }: Props) {
  if (!invoice) {
    return (
      <section aria-labelledby="titulo-situacao" className={estilos['situacao']}>
        <h2 id="titulo-situacao">Situação atual</h2>
        <p data-testid="sem-pendencia" className={estilos['emDia']}>
          Nenhuma cobrança em aberto para este aluno.
        </p>
      </section>
    );
  }

  const atraso = invoice.status === 'OVERDUE' ? diasDeAtraso(invoice.dueAt, agora) : 0;

  return (
    <section aria-labelledby="titulo-situacao" className={estilos['situacao']}>
      <h2 id="titulo-situacao">Situação atual</h2>

      <div className={estilos['destaque']} data-testid="invoice-em-destaque">
        <Money cents={invoice.totalMinor} currency={invoice.currency} />
        <StateBadge machine="invoice" state={invoice.status} />
        <span className={estilos['vencimento']}>
          Vence em <TenantDateTime iso={invoice.dueAt} timeZone={timezone} format="date" />
        </span>
        {atraso > 0 ? (
          <span className={estilos['atraso']} data-testid="dias-de-atraso">
            {atraso} {atraso === 1 ? 'dia' : 'dias'} de atraso
          </span>
        ) : null}
      </div>
    </section>
  );
}
