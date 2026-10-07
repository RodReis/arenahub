import { diaDoPagamento } from '../../modules/billing/domain/cancelamento-de-pagamento.js';
import { instanteDeBloqueio, proximoVencimento } from '../../modules/billing/domain/ciclo-de-cobranca.js';
import { vencimentoAposPagamento } from '../../modules/billing/domain/meses-pagaveis.js';

/** Saneamento da F88 -- funcoes puras, o "agora" entra por parametro. */

export interface FaturaAberta {
  readonly billingPeriod: Date;
  readonly status: 'OPEN' | 'OVERDUE';
  readonly dueAt: Date;
  readonly blockAt: Date | null;
}

export interface Politica {
  readonly dueDay: number;
  readonly graceDays: number;
  readonly fuso: string;
}

/**
 * Vencimento no dia do ciclo e bloqueio na meia-noite local de venc. + carencia.
 * OVERDUE cujo novo bloqueio e futuro volta a OPEN. `null` = nada a mudar.
 */
export function planejarFaturaAberta(
  fatura: FaturaAberta,
  politica: Politica,
  agora: Date,
): { dueAt: Date; blockAt: Date; status: 'OPEN' | 'OVERDUE' } | null {
  const dueAt = proximoVencimento(fatura.billingPeriod, politica.dueDay);
  const blockAt = instanteDeBloqueio(dueAt, politica.graceDays, politica.fuso);
  const status = fatura.status === 'OVERDUE' && blockAt.getTime() > agora.getTime() ? 'OPEN' : fatura.status;

  const igual =
    fatura.dueAt.getTime() === dueAt.getTime() &&
    fatura.blockAt?.getTime() === blockAt.getTime() &&
    fatura.status === status;

  return igual ? null : { dueAt, blockAt, status };
}

/** Instante em que a fatura NOVA da competencia passa a bloquear (vencimento + carencia, meia-noite local). */
export function bloqueioDaFaturaNova(competencia: Date, politica: Politica): Date {
  return instanteDeBloqueio(proximoVencimento(competencia, politica.dueDay), politica.graceDays, politica.fuso);
}

export interface FaturaPaga {
  readonly invoiceId: string;
  readonly billingPeriod: Date;
  /** `paidAt` do primeiro pagamento CONFIRMED da fatura. */
  readonly paidAt: Date;
  readonly batchId: string | null;
}

/** Cobertura de cada fatura paga: dia do pagamento + 30 x posicao no lote (por competencia). */
export function coberturasDosPagos(pagas: readonly FaturaPaga[]): Map<string, Date> {
  const grupos = new Map<string, FaturaPaga[]>();

  for (const paga of pagas) {
    const chave = paga.batchId ?? `avulso:${paga.invoiceId}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), paga]);
  }

  const resultado = new Map<string, Date>();

  for (const grupo of grupos.values()) {
    [...grupo]
      .sort((a, b) => a.billingPeriod.getTime() - b.billingPeriod.getTime())
      .forEach((paga, i) => resultado.set(paga.invoiceId, vencimentoAposPagamento(diaDoPagamento(paga.paidAt), i + 1)));
  }

  return resultado;
}
