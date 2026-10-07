import { Injectable, Logger } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { BillingRepository } from './billing.repository.js';
import { competenciaDe } from './domain/ciclo-de-cobranca.js';

export interface ResultadoDaGeracao {
  readonly elegiveis: number;
  readonly criadas: number;
  readonly jaExistiam: number;
  readonly falhas: number;
}

/**
 * Fatura do mes para todo aluno que depende de plano (F88, decisao do PI em
 * 07/10/2026): perfil STUDENT, aluno ATIVO, assinatura vigente, plano mensal
 * (diaria nao e contrato -- F86). Vence no `dueDay` do tenant.
 *
 * NADA DE REGRA NOVA: cada fatura sai de `abrirInvoiceDoPeriodo`, idempotente
 * por INV-066 -- rodar duas vezes devolve a mesma fatura e nao gasta numero.
 * Serial de proposito: a base tem centenas de alunos, nao milhoes.
 *
 * Exige contexto de tenant aberto (interceptor da requisicao ou `comContexto`
 * do scheduler): `abrirInvoiceDoPeriodo` sem `tx` usa o `$transaction` que
 * aplica o contexto do `AsyncLocalStorage`.
 */
@Injectable()
export class GerarFaturasDoMesUseCase {
  private readonly log = new Logger(GerarFaturasDoMesUseCase.name);

  constructor(
    private readonly db: PrismaService,
    private readonly billing: BillingRepository,
  ) {}

  async executar(tenantId: string, agora: Date): Promise<ResultadoDaGeracao> {
    const competencia = competenciaDe(agora);
    // Job nao tem usuario; `actorId` nao e gravado na abertura de fatura.
    const contexto: TenantContext = {
      tenantId,
      actorId: 'sistema:gerar-faturas-do-mes',
      sessionId: 'gerar-faturas-do-mes',
      permissions: new Set<string>(),
      allowedUnitIds: 'ALL',
    };

    // `comTenant`: o filtro passa por `students`, que tem RLS (issue #306).
    const assinaturas = await this.db.comTenant((tx) =>
      tx.subscription.findMany({
        where: {
          tenantId,
          status: { in: ['ACTIVE', 'PAST_DUE'] },
          plan: { billingMode: { not: 'DIARIA' } },
          student: { profile: 'STUDENT', status: 'ACTIVE' },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    );

    // `invoices` nao tem politica RLS (so `students`, `audit_logs` e
    // `tenant_app_distribution` tem): leitura solta, filtrada por `tenantId`.
    const jaExistentes = new Set(
      (
        await this.db.invoice.findMany({
          where: { tenantId, billingPeriod: competencia, subscriptionId: { in: assinaturas.map((a) => a.id) } },
          select: { subscriptionId: true },
        })
      ).map((i) => i.subscriptionId),
    );

    let criadas = 0;
    let falhas = 0;

    for (const { id } of assinaturas) {
      if (jaExistentes.has(id)) continue;

      try {
        await this.billing.abrirInvoiceDoPeriodo(contexto, { subscriptionId: id, emQue: agora });
        criadas += 1;
      } catch (erro: unknown) {
        falhas += 1;
        this.log.error(
          `falha ao gerar fatura da assinatura ${id} (tenant ${tenantId}): ${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
        );
      }
    }

    return { elegiveis: assinaturas.length, criadas, jaExistiam: jaExistentes.size, falhas };
  }
}
