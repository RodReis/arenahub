import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

import { vencimentoAposPagamento } from './meses-pagaveis.js';

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
 * O DIA em que o lote ancorou o vencimento: meia-noite UTC do dia UTC de
 * `paidAt`. O lote grava o instante real (hoje) ou meio-dia UTC (dia passado)
 * em `Payment.paidAt`, mas ancora o vencimento no DIA informado
 * (`ancorarProximoVencimento`).
 *
 * ponytail: recepcao que paga depois das 21h (Brasil) manda o dia local e o
 * `paidAt` cai no dia UTC seguinte; os dois dias divergem, o vencimento nao
 * casa e NAO e restaurado. Falha para o lado seguro (nao toca). Se aparecer
 * na pratica, guardar o dia ancorado no lote.
 */
export function diaDoPagamento(paidAt: Date): Date {
  return new Date(Date.UTC(paidAt.getUTCFullYear(), paidAt.getUTCMonth(), paidAt.getUTCDate()));
}

/**
 * O vencimento da fatura seguinte ainda e o que ESTE lote gravou?
 *
 * Conservador de proposito -- so devolve ao padrao do ciclo quando (a) o lote
 * inteiro foi desfeito e (b) o `dueAt` atual e exatamente o ancorado
 * (`dia + N * 30 dias`, N = tamanho do lote). Qualquer outra coisa significa
 * que outro pagamento ou a recepcao ja mexeu naquela data, e sobrescreve-la
 * apagaria uma decisao.
 */
export function deveRestaurarVencimento(entrada: {
  readonly dueAtAtual: Date;
  readonly paidAt: Date;
  readonly tamanhoDoLote: number;
  readonly confirmadosRestantesNoLote: number;
}): boolean {
  if (entrada.confirmadosRestantesNoLote > 0) {
    return false;
  }

  const ancora = vencimentoAposPagamento(diaDoPagamento(entrada.paidAt), entrada.tamanhoDoLote);

  return entrada.dueAtAtual.getTime() === ancora.getTime();
}
