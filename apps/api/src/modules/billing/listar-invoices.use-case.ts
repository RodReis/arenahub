import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

/** Teto do tamanho da pagina -- sem ele um cliente pede 100000 e a rota vira despejo do financeiro inteiro. */
export const TAMANHO_MAXIMO_DA_PAGINA = 100;

export interface FiltroDeInvoices {
  status?: string;
  vencendoDe?: Date;
  vencendoAte?: Date;
  pagina: number;
  tamanho: number;
}

export interface InvoiceDaListaDto {
  id: string;
  number: number;
  status: string;
  currency: string;
  billingPeriod: Date;
  totalMinor: number;
  dueAt: Date;
  paidAt: Date | null;
  studentId: string;
}

export interface PaginaDeInvoices {
  itens: InvoiceDaListaDto[];
  total: number;
  pagina: number;
  tamanho: number;
}

/**
 * Lista transversal de faturas do tenant -- a visao de gestao. F53, task 6.
 *
 * NAO FILTRA POR ALUNO -- e a diferenca para `listarInvoicesDoAluno`
 * (`BillingRepository`). `tenantId` no `where` e obrigatorio aqui MAIS do
 * que em qualquer outra leitura do modulo: sem ele, esta rota devolveria o
 * financeiro de todas as academias de uma vez (regra de arquitetura no 2).
 *
 * `orderBy: dueAt desc, id desc` -- SEMPRE. Sem `orderBy` explicito o
 * Postgres devolve na ordem fisica, que muda apos qualquer `UPDATE`: a
 * mesma pagina traria linhas diferentes entre duas cargas. `id` desempata
 * `dueAt` igual, senao duas faturas do mesmo vencimento trocam de lugar
 * entre paginas e uma delas nunca aparece.
 *
 * PERIODO FECHADO nas duas pontas (`gte`/`lte`): fatura que vence exatamente
 * no limite entra. `gt`/`lt` perderia a borda e a fatura do dia 31 sumiria
 * quando alguem pesquisa "ate o dia 31".
 */
@Injectable()
export class ListarInvoicesUseCase {
  constructor(private readonly db: PrismaService) {}

  async executar(contexto: TenantContext, filtro: FiltroDeInvoices): Promise<PaginaDeInvoices> {
    const tamanho = Math.min(filtro.tamanho, TAMANHO_MAXIMO_DA_PAGINA);
    const pagina = Math.max(filtro.pagina, 1);

    const where = {
      tenantId: contexto.tenantId,
      ...(filtro.status ? { status: filtro.status as never } : {}),
      ...(filtro.vencendoDe || filtro.vencendoAte
        ? {
            dueAt: {
              ...(filtro.vencendoDe ? { gte: filtro.vencendoDe } : {}),
              ...(filtro.vencendoAte ? { lte: filtro.vencendoAte } : {}),
            },
          }
        : {}),
    };

    const [itens, total] = await this.db.$transaction([
      this.db.invoice.findMany({
        where,
        orderBy: [{ dueAt: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * tamanho,
        take: tamanho,
        select: {
          id: true,
          number: true,
          status: true,
          currency: true,
          billingPeriod: true,
          totalMinor: true,
          dueAt: true,
          paidAt: true,
          studentId: true,
        },
      }),
      this.db.invoice.count({ where }),
    ]);

    return { itens, total, pagina, tamanho };
  }
}
