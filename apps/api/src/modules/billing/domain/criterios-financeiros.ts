import type { Prisma } from '@arenahub/database';

/**
 * Os dois critérios financeiros que mais de uma tela usa, num lugar só.
 *
 * Antes daqui cada um morava dentro do use-case da tela de Cobrança
 * (`consultar-inadimplencia` e `consultar-pagos`). O Relatório de Alunos
 * precisa responder "quem está inadimplente?" e "quem é pagante?" com a MESMA
 * resposta da Cobrança: duas cópias divergem na primeira edição, e o gestor
 * veria um número no relatório e outro na fila de cobrança.
 */

/**
 * Fatura vencida e em aberto -- o que a tela Cobrança chama de inadimplência.
 * `agora` entra por parâmetro: o critério depende do relógio.
 */
export function faturaVencidaEmAberto(agora: Date): Prisma.InvoiceWhereInput {
  return { status: { in: ['OPEN', 'OVERDUE'] }, dueAt: { lt: agora } };
}

/** Fatura paga -- o que a aba Pagantes considera. */
export const FATURA_PAGA: Prisma.InvoiceWhereInput = { status: 'PAID', paidAt: { not: null } };
