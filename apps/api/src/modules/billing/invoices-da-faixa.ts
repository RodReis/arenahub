import type { PrismaService } from '../../persistence/prisma.service.js';

import type { InvoiceParaFaixa } from './domain/meses-pagaveis.js';

/**
 * Invoices que alimentam a faixa de meses pagaveis de uma assinatura.
 *
 * A faixa olha o ALUNO, nao so a assinatura ativa: aluno que passou por
 * duplicata consolidada ou troca de plano pode ter fatura em aberto presa a
 * assinatura CANCELLED, e sem enxerga-la a recepcao nao tem como quitar o
 * mes (caso real: set/2026, 7 alunos).
 *
 * - `OPEN`/`OVERDUE` de qualquer assinatura do aluno entram -- exceto quando a
 *   assinatura ativa ja tem fatura em aberto da mesma competencia (a da
 *   ativa vence, para nao cobrar o mes duas vezes);
 * - `PAID`/`REFUNDED` de qualquer assinatura entram: dinheiro ja resolvido
 *   tira o mes da faixa;
 * - `CANCELLED` so conta quando e da assinatura ativa (mes dispensado). Uma
 *   fatura cancelada pela troca de plano, em assinatura antiga, nao pode
 *   esconder o mes da assinatura nova.
 */
export async function invoicesDaFaixa(
  db: PrismaService,
  tenantId: string,
  assinatura: { id: string; studentId: string },
): Promise<InvoiceParaFaixa[]> {
  const invoices = await db.invoice.findMany({
    where: {
      tenantId,
      studentId: assinatura.studentId,
      OR: [
        { status: { in: ['OPEN', 'OVERDUE', 'PAID', 'REFUNDED'] } },
        { status: 'CANCELLED', subscriptionId: assinatura.id },
      ],
    },
  });

  const abertasDaAtiva = new Set(
    invoices
      .filter((i) => i.subscriptionId === assinatura.id && (i.status === 'OPEN' || i.status === 'OVERDUE'))
      .map((i) => i.billingPeriod.getTime()),
  );

  return invoices.filter(
    (i) =>
      i.subscriptionId === assinatura.id ||
      !(i.status === 'OPEN' || i.status === 'OVERDUE') ||
      !abertasDaAtiva.has(i.billingPeriod.getTime()),
  ) as InvoiceParaFaixa[];
}
