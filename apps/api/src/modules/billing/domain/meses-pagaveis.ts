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
 * competencia corrente + 6. A LISTA e continua, mas a ESCOLHA e livre (decisao
 * do PI, 01/10/2026, substitui a Decisao 1 de 30/09: "pagou usou", sem
 * contrato de 12 meses -- nao se obriga pagar mes que o aluno nao usou).
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

  const resolvidos = new Set(
    entrada.invoices
      .filter((i) => i.status !== 'OPEN' && i.status !== 'OVERDUE')
      .map((i) => i.billingPeriod.getTime()),
  );

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

    // Mes que ja tem invoice resolvida (PAID/CANCELLED/REFUNDED) nao e mais
    // pagavel: sem isto, mes pago continuava aparecendo como "Adiantado".
    if (resolvidos.has(cursor.getTime())) {
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      continue;
    }

    if (existente) {
      meses.push({
        competencia: cursor,
        status: existente.status as StatusDoMesPagavel,
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

const MS_POR_DIA = 24 * 60 * 60 * 1000;
/** Cada mes pago cobre 30 dias a partir da data do pagamento (decisao do PI, 01/10/2026). */
const DIAS_POR_MES_PAGO = 30;

export class DataDePagamentoFuturaError extends ErroDeDominio {
  constructor() {
    super('BILLING_PAID_AT_IN_FUTURE', 422, 'a data do pagamento nao pode ser futura');
  }
}

/**
 * Meses escolhidos pela recepcao, em ordem cronologica. Qualquer subconjunto
 * da faixa vale -- nao ha prefixo obrigatorio.
 */
export function resolverLote(faixa: readonly MesPagavel[], competencias: readonly Date[]): MesPagavel[] {
  if (competencias.length === 0) {
    throw new LoteInvalidoError('selecione ao menos um mes');
  }

  const alvo = new Set(competencias.map((c) => c.getTime()));

  if (alvo.size !== competencias.length) {
    throw new LoteInvalidoError('mes repetido na selecao');
  }

  const lote = faixa.filter((m) => alvo.has(m.competencia.getTime()));

  if (lote.length !== alvo.size) {
    throw new LoteInvalidoError('competencia informada nao esta na faixa pagavel');
  }

  return lote;
}

/**
 * Meses anteriores ao ultimo pago que a recepcao dispensa (nao usados). So
 * faz sentido para mes que tem invoice; mes sem invoice nao deve nada e e
 * ignorado. Nunca dispensa mes pago neste lote nem mes POSTERIOR ao ultimo
 * pago -- isso perdoaria cobranca futura sem o aluno ter pago nada.
 */
export function resolverDispensa(
  faixa: readonly MesPagavel[],
  pagas: readonly MesPagavel[],
  dispensar: readonly Date[],
): MesPagavel[] {
  const ultimaPaga = Math.max(...pagas.map((m) => m.competencia.getTime()));
  const pagasSet = new Set(pagas.map((m) => m.competencia.getTime()));
  const dispensadas: MesPagavel[] = [];

  for (const competencia of dispensar) {
    const mes = faixa.find((m) => m.competencia.getTime() === competencia.getTime());

    if (!mes) {
      throw new LoteInvalidoError('mes a dispensar nao esta na faixa');
    }

    if (pagasSet.has(mes.competencia.getTime())) {
      throw new LoteInvalidoError('mes nao pode ser pago e dispensado no mesmo lote');
    }

    if (mes.competencia.getTime() > ultimaPaga) {
      throw new LoteInvalidoError('so e possivel dispensar mes anterior ao ultimo mes pago');
    }

    if (mes.invoiceId !== null) {
      dispensadas.push(mes);
    }
  }

  return dispensadas;
}

/**
 * O instante gravado como `paidAt`. A recepcao informa so o DIA: hoje usa o
 * instante real; dia passado vira meio-dia UTC (09h no Brasil), que nunca
 * muda o dia por causa do fuso -- meia-noite UTC apareceria como 21h do dia
 * anterior na tela.
 */
export function instanteDoPagamento(dia: Date, agora: Date): Date {
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());

  if (dia.getTime() > hoje) {
    throw new DataDePagamentoFuturaError();
  }

  return dia.getTime() === hoje ? agora : new Date(dia.getTime() + 12 * 60 * 60 * 1000);
}

/**
 * Recusa pagamento manual datado depois de hoje. Compara o DIA (UTC), como
 * `instanteDoPagamento` faz no lote: o painel manda o instante de agora, e uma
 * comparacao de instante exato recusaria um pagamento legitimo por milissegundos
 * de diferenca entre os relogios do painel e da API.
 */
export function exigirPagamentoNaoFuturo(paidAt: Date, agora: Date): void {
  const dia = Date.UTC(paidAt.getUTCFullYear(), paidAt.getUTCMonth(), paidAt.getUTCDate());
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());

  if (dia > hoje) {
    throw new DataDePagamentoFuturaError();
  }
}

/** Fim da vigencia: data do pagamento + 30 dias por mes pago, acumulando. */
export function vencimentoAposPagamento(dia: Date, mesesPagos: number): Date {
  return new Date(dia.getTime() + mesesPagos * DIAS_POR_MES_PAGO * MS_POR_DIA);
}
