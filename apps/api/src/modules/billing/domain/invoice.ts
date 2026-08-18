import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';
import { somarItens, validarValorMonetario, type ItemParaSomar } from './dinheiro.js';

/**
 * Ciclo de vida da invoice. `CONVENTION.md` 3.4.
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`).
 *
 * DOIS PONTOS QUE O `CONVENTION.md` DEIXOU `[indefinido]` e que decido aqui,
 * por serem reversiveis (processo de 18/08/2026 -- decide, implementa e
 * registra no PR):
 *
 * 1. `DRAFT -> OPEN` acontece quando a invoice tem ao menos UM item e um
 *    vencimento. Invoice sem item nao tem o que cobrar, e abrir uma vazia
 *    produziria cobranca de zero que ninguem sabe interpretar.
 * 2. `CANCELLED` so a partir de `DRAFT` ou `OPEN`. Invoice paga que precisa
 *    voltar atras e ESTORNO, com estado proprio -- cancelar uma paga
 *    apagaria o fato de que o dinheiro entrou (INV-069, INV-073).
 */

export type StatusDaInvoice = 'DRAFT' | 'OPEN' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'REFUNDED';

export class InvoiceInvalidaError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_INVALID_INVOICE', 422, motivo);
  }
}

export interface TotaisDaInvoice {
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
}

export function calcularTotais(
  itens: readonly ItemParaSomar[],
  discountMinor: number,
): TotaisDaInvoice {
  validarValorMonetario(discountMinor);
  const subtotalMinor = somarItens(itens);

  if (discountMinor > subtotalMinor) {
    throw new InvoiceInvalidaError('desconto nao pode ser maior que o subtotal');
  }

  return { subtotalMinor, discountMinor, totalMinor: subtotalMinor - discountMinor };
}

export interface EntradaDeAbertura {
  itens: readonly ItemParaSomar[];
  discountMinor: number;
  dueAt: Date;
}

export function abrirInvoice(entrada: EntradaDeAbertura): TotaisDaInvoice & {
  status: StatusDaInvoice;
  dueAt: Date;
} {
  if (entrada.itens.length === 0) {
    throw new InvoiceInvalidaError('invoice sem item nao abre; nao ha o que cobrar');
  }

  return {
    ...calcularTotais(entrada.itens, entrada.discountMinor),
    status: 'OPEN',
    dueAt: entrada.dueAt,
  };
}

/**
 * Transicoes permitidas.
 *
 * `PAID` e terminal para efeito de cobranca: nao volta a `OPEN`, nao vence,
 * nao cancela (INV-069). A unica saida e `REFUNDED`, que e movimento
 * proprio -- e por isso a tabela de estorno tem estado separado.
 */
const TRANSICOES: Readonly<Record<StatusDaInvoice, readonly StatusDaInvoice[]>> = {
  DRAFT: ['OPEN', 'CANCELLED'],
  OPEN: ['PAID', 'OVERDUE', 'CANCELLED'],
  OVERDUE: ['PAID', 'CANCELLED'],
  PAID: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

export function podeTransicionar(de: StatusDaInvoice, para: StatusDaInvoice): boolean {
  return TRANSICOES[de].includes(para);
}

export interface ResultadoDoPagamento {
  status: StatusDaInvoice;
  creditoMinor: number;
}

/**
 * Aplica um pagamento contra o total da invoice.
 *
 * PAGAMENTO PARCIAL NAO EXISTE no MVP 2 (ADR-027, resposta 1 do PI): R$ 119
 * numa mensalidade de R$ 120 e REJEITADO, nao vira saldo devedor.
 * Sobrepagamento e aceito e a diferenca vira credito do aluno (resposta 4).
 *
 * A assimetria e deliberada e conhecida: so e coerente se a academia nao
 * aceitar pagamento parcial no balcao. Se na pratica a recepcao aceitar, a
 * resposta 1 precisa ser reaberta -- dinheiro que entra sem registro e pior
 * que modelo complicado (ADR-027, consequencia 2).
 */
export function aplicarPagamento(totalMinor: number, valorPagoMinor: number): ResultadoDoPagamento {
  validarValorMonetario(valorPagoMinor);

  if (valorPagoMinor < totalMinor) {
    throw new InvoiceInvalidaError(
      'pagamento parcial nao e aceito no MVP 2; a invoice so fecha com o valor integral',
    );
  }

  return { status: 'PAID', creditoMinor: valorPagoMinor - totalMinor };
}
