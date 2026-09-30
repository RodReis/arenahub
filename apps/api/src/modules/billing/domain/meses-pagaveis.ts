import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

import { competenciaDe, proximoVencimento } from './ciclo-de-cobranca.js';
import { precoVigenteEm, type PrecoDePlano } from './dinheiro.js';

const TETO_MESES_ADIANTADOS = 6;

export type StatusDoMesPagavel = 'OVERDUE' | 'OPEN' | 'NOT_OPENED';

export interface MesPagavel {
  readonly competencia: Date;
  readonly status: StatusDoMesPagavel;
  readonly invoiceId: string | null;
  readonly totalMinor: number;
  readonly dueAt: Date;
}

export interface InvoiceParaFaixa {
  readonly id: string;
  readonly billingPeriod: Date;
  readonly status: 'OPEN' | 'OVERDUE' | 'PAID' | 'CANCELLED' | 'REFUNDED';
  readonly totalMinor: number;
  readonly dueAt: Date;
}

export class LoteInvalidoError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_BATCH_OUT_OF_RANGE', 422, motivo);
  }
}

/**
 * Meses pagaveis: do mais antigo em aberto (OVERDUE/OPEN) ate a
 * competencia corrente + 6. Nunca pula mes -- e o que da a Decisao 1 do PI
 * (30/09/2026): selecao sem buraco.
 *
 * So invoice OVERDUE/OPEN entra na faixa; PAID/CANCELLED/REFUNDED ja
 * resolveram e nao aparecem aqui (elas ficam na tabela de historico).
 */
export function mesesPagaveis(entrada: {
  invoices: readonly InvoiceParaFaixa[];
  agora: Date;
  endsAt: Date | null;
  prices: readonly PrecoDePlano[];
  dueDay: number;
}): MesPagavel[] {
  const emAberto = entrada.invoices
    .filter((i) => i.status === 'OPEN' || i.status === 'OVERDUE')
    .sort((a, b) => a.billingPeriod.getTime() - b.billingPeriod.getTime());

  const competenciaCorrente = competenciaDe(entrada.agora);
  const inicio = emAberto[0]?.billingPeriod ?? competenciaCorrente;

  const teto = new Date(Date.UTC(competenciaCorrente.getUTCFullYear(), competenciaCorrente.getUTCMonth() + TETO_MESES_ADIANTADOS, 1));

  const meses: MesPagavel[] = [];
  let cursor = new Date(inicio);

  while (cursor.getTime() <= teto.getTime()) {
    if (entrada.endsAt && cursor.getTime() >= entrada.endsAt.getTime()) {
      break;
    }

    const existente = emAberto.find((i) => i.billingPeriod.getTime() === cursor.getTime());

    if (existente) {
      meses.push({
        competencia: cursor,
        status: existente.status,
        invoiceId: existente.id,
        totalMinor: existente.totalMinor,
        dueAt: existente.dueAt,
      });
    } else {
      const preco = precoVigenteEm(entrada.prices, cursor);
      meses.push({
        competencia: cursor,
        status: 'NOT_OPENED',
        invoiceId: null,
        totalMinor: preco?.amountMinor ?? 0,
        dueAt: proximoVencimento(cursor, entrada.dueDay),
      });
    }

    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  return meses;
}

/**
 * Recorta a faixa do inicio ate `ateCompetencia`, inclusive.
 *
 * Nao aceita excluir o mais antigo: a faixa ja comeca no mes em aberto mais
 * antigo (Decisao 1 do PI), entao "pagar so parte dos vencidos" nunca e uma
 * opcao valida aqui -- e por isso o corte e sempre um PREFIXO da faixa.
 */
export function resolverLote(faixa: readonly MesPagavel[], ateCompetencia: Date): MesPagavel[] {
  const indice = faixa.findIndex((m) => m.competencia.getTime() === ateCompetencia.getTime());

  if (indice === -1) {
    throw new LoteInvalidoError('competencia informada nao esta na faixa pagavel');
  }

  return faixa.slice(0, indice + 1);
}
