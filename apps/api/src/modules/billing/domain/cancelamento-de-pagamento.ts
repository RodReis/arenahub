import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

import { competenciaDe } from './ciclo-de-cobranca.js';

/**
 * Cancelamento de pagamento MANUAL lancado por engano. F85, decisao do PI em
 * 05/10/2026.
 *
 * EMENDA DO INV-069 so para pagamento `MANUAL`: a fatura paga volta a `OPEN`.
 * PIX e cartao seguem so pelo estorno com provedor (`estorno.ts`) -- dinheiro
 * que passou por provedor nao se "cancela", se devolve.
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`).
 */

export class PagamentoNaoCancelavelError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_PAYMENT_NOT_CANCELLABLE', 409, motivo);
  }
}

export class CancelamentoInvalidoError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_INVALID_CANCEL', 422, motivo);
  }
}

/**
 * O credito do sobrepagamento ja abateu OUTRA fatura. Cancelar o pagamento
 * deixaria o aluno com abatimento sem origem -- a recepcao nao resolve isso
 * sozinha, e o 409 diz exatamente que o caso e do gerente.
 */
export class CreditoJaAplicadoError extends ErroDeDominio {
  constructor() {
    super(
      'BILLING_CREDIT_ALREADY_APPLIED',
      409,
      'o credito gerado por este pagamento ja foi usado em outra cobranca; nao e possivel cancelar',
    );
  }
}

/** Recibo de pagamento cancelado nao circula: o recebimento nao vale mais. */
export class PagamentoCanceladoError extends ErroDeDominio {
  constructor() {
    super('BILLING_PAYMENT_CANCELLED', 409, 'o pagamento deste recibo foi cancelado');
  }
}

export interface PagamentoParaCancelar {
  readonly method: string;
  readonly status: string;
}

/**
 * ORDEM DAS GUARDAS IMPORTA: o metodo vem antes do motivo. Quem tenta cancelar
 * um PIX com o motivo em branco precisa ouvir "isto nao se cancela aqui", e
 * nao "escreva o motivo" -- escrever o motivo nao resolveria nada.
 */
export function validarCancelamento(pagamento: PagamentoParaCancelar, reason: string): void {
  if (pagamento.method !== 'MANUAL') {
    throw new PagamentoNaoCancelavelError(
      'so pagamento manual e cancelado por aqui; PIX e cartao passam pelo estorno',
    );
  }

  if (pagamento.status !== 'CONFIRMED') {
    throw new PagamentoNaoCancelavelError(
      `pagamento em ${pagamento.status} nao pode ser cancelado; so CONFIRMED`,
    );
  }

  if (reason.trim().length < 3) {
    throw new CancelamentoInvalidoError('motivo do cancelamento e obrigatorio (minimo 3 caracteres)');
  }
}

/**
 * O dia que conta a cobertura do mes pago (`coverageEndsAt`, F88): meia-noite
 * UTC do dia UTC de `paidAt`. O lote grava o instante real (hoje) ou meio-dia
 * UTC (dia passado) em `Payment.paidAt`.
 */
export function diaDoPagamento(paidAt: Date): Date {
  return new Date(Date.UTC(paidAt.getUTCFullYear(), paidAt.getUTCMonth(), paidAt.getUTCDate()));
}

/** O que o cancelamento faz com a fatura. */
export type EfeitoDoCancelamento = 'REABRE_FATURA' | 'FATURA_CONTINUA_PAGA';

/**
 * QUANDO se cancela -- decisao do PI em 05/10/2026 (depois da F85): "so pode
 * cancelar o que esta adiantado ou mais de 1 pagamento no mesmo mes, e mes
 * que ja passou NAO se cancela".
 *
 * - "Mesmo mes" e a mesma COMPETENCIA com 2+ pagamentos confirmados (ex.:
 *   nov/26 pago em dinheiro e tambem por PIX). Cancela o extra e a fatura
 *   continua paga pelo outro.
 * - Mes corrente com UM pagamento so nao cancela: o caso fica com o gerente.
 * - Mes que ja passou nunca cancela, nem duplicado.
 *
 * ponytail: competencia corrente pelo mes UTC (`competenciaDe`), o mesmo
 * corte da faixa de meses pagaveis; na virada do mes ha 3h (21h-0h BRT) em
 * que o "mes corrente" ja e o seguinte. Se incomodar, passar o fuso da
 * unidade para as duas.
 */
export function decidirCancelamento(entrada: {
  readonly competencia: Date;
  readonly agora: Date;
  readonly confirmadosNaFatura: number;
}): EfeitoDoCancelamento {
  const corrente = competenciaDe(entrada.agora).getTime();
  const competencia = entrada.competencia.getTime();

  if (competencia < corrente) {
    throw new PagamentoNaoCancelavelError('pagamento de mes que ja passou nao se cancela');
  }

  if (entrada.confirmadosNaFatura >= 2) {
    return 'FATURA_CONTINUA_PAGA';
  }

  if (competencia > corrente) {
    return 'REABRE_FATURA';
  }

  throw new PagamentoNaoCancelavelError(
    'pagamento do mes corrente so se cancela quando ha mais de um pagamento no mesmo mes',
  );
}

/**
 * A mesma regra sem lancar, para a GRADE decidir se oferece a acao. Uma regra
 * so, chamada pelos dois lados -- a tela nao reimplementa o corte de mes.
 */
export function podeCancelarPagamento(entrada: {
  readonly method: string;
  readonly status: string;
  readonly competencia: Date;
  readonly agora: Date;
  readonly confirmadosNaFatura: number;
}): boolean {
  if (entrada.method !== 'MANUAL' || entrada.status !== 'CONFIRMED') {
    return false;
  }

  try {
    decidirCancelamento(entrada);

    return true;
  } catch (erro) {
    if (erro instanceof PagamentoNaoCancelavelError) {
      return false;
    }

    throw erro;
  }
}

/**
 * Quando a fatura tem 2+ pagamentos e um deles e cancelado, QUAL dinheiro
 * passa a quita-la?
 *
 * So um pagamento quitou de fato a fatura; os que chegaram depois (o PIX cujo
 * webhook encontrou a fatura ja `PAID`) viraram credito do aluno. Cancelar o
 * EXTRA so expira o credito dele. Cancelar o QUE QUITOU transfere a quitacao:
 * consome o total da fatura do credito disponivel de outro pagamento -- senao
 * o aluno ficaria com a fatura paga E o mesmo dinheiro de credito.
 *
 * Devolve o credito a consumir (e quanto sobra nele), ou `null` quando nao ha
 * o que transferir. Recusa quando o quitador sai e nenhum credito disponivel
 * cobre a fatura (ja foi usado em outra cobranca).
 */
export function creditoAConsumir(entrada: {
  readonly totalDaFaturaMinor: number;
  readonly pagoNoCanceladoMinor: number;
  readonly creditoDoCanceladoMinor: number;
  readonly creditosDisponiveisDosOutros: readonly { readonly id: string; readonly amountMinor: number }[];
}): { creditId: string; restanteMinor: number } | null {
  const quitouAFatura =
    entrada.pagoNoCanceladoMinor - entrada.creditoDoCanceladoMinor >= entrada.totalDaFaturaMinor;

  if (!quitouAFatura) {
    return null;
  }

  const cobre = entrada.creditosDisponiveisDosOutros.find(
    (credito) => credito.amountMinor >= entrada.totalDaFaturaMinor,
  );

  if (!cobre) {
    throw new CreditoJaAplicadoError();
  }

  return { creditId: cobre.id, restanteMinor: cobre.amountMinor - entrada.totalDaFaturaMinor };
}
