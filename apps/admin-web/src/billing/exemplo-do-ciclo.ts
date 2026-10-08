import type { ConfiguracaoDePagamento } from '../../app/actions/configuracao-de-pagamento';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

export interface ExemploDoCiclo {
  readonly competencia: string;
  readonly gerada: string;
  readonly vence: string;
  readonly bloqueia: string;
}

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Exemplo do ciclo de uma parcela, em texto pronto para a tela -- F89.
 *
 * Sem `Intl` (regra 5 de lint): o mês abreviado sai de lista fixa e a data de
 * bloqueio de `Date.UTC`, que já rola o fim do mês para o seguinte (28 + 5
 * dias em novembro cai em 03/12). `mes` é 1..12.
 */
export function exemploDoCiclo(
  c: ConfiguracaoDePagamento,
  referencia: { readonly ano: number; readonly mes: number },
): ExemploDoCiclo {
  const { ano, mes } = referencia;
  const bloqueio = new Date(Date.UTC(ano, mes - 1, c.dueDay + c.graceDays));

  return {
    competencia: `${MESES[mes - 1]}/${doisDigitos(ano % 100)}`,
    gerada: `${doisDigitos(c.invoiceGenerationDay)}/${doisDigitos(mes)}`,
    vence: `${doisDigitos(c.dueDay)}/${doisDigitos(mes)}`,
    bloqueia: `${doisDigitos(bloqueio.getUTCDate())}/${doisDigitos(bloqueio.getUTCMonth() + 1)}`,
  };
}
