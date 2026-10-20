import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { BillingRepository } from './billing.repository.js';
import { competenciaDe, inicioDoProximoCiclo, vencimentoPelaCobertura } from './domain/ciclo-de-cobranca.js';

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
/**
 * Quem recebe fatura mensal (SPEC-088 3). Fonte unica: o job e o script de
 * saneamento (`padronizar-vencimentos`) usam esta mesma consulta.
 *
 * Alem do status, a VIGENCIA: contrato que terminou (`endsAt <= agora`) ainda
 * pode estar `ACTIVE` -- o job de expiracao roda na mesma virada e nao ha ordem
 * garantida -- e assinatura vendida com `startsAt` em mes futuro nao deve ser
 * cobrada agora. `startsAt` dentro do mes corrente continua elegivel.
 */
export function assinaturasElegiveisParaFaturaMensal(
  tenantId: string,
  agora: Date,
): Prisma.SubscriptionWhereInput {
  return {
    tenantId,
    status: { in: ['ACTIVE', 'PAST_DUE'] },
    plan: { billingMode: { not: 'DIARIA' } },
    student: { profile: 'STUDENT', status: 'ACTIVE' },
    AND: [
      { OR: [{ endsAt: null }, { endsAt: { gt: agora } }] },
      { startsAt: { lt: inicioDoProximoCiclo(agora) } },
    ],
  };
}

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
        where: assinaturasElegiveisParaFaturaMensal(tenantId, agora),
        select: { id: true, studentId: true },
        orderBy: { id: 'asc' },
      }),
    );

    // Ultimo pagamento de plano mensal de cada aluno: maior `paidAt`, empate pela
    // maior cobertura. Diaria fica de fora -- a cobertura dela e o fim do dia.
    // `invoices` nao tem politica RLS (ver abaixo).
    const ultimosPagamentos = await this.db.invoice.findMany({
      where: {
        tenantId,
        studentId: { in: assinaturas.map((a) => a.studentId) },
        status: 'PAID',
        paidAt: { not: null },
        coverageEndsAt: { not: null },
        subscription: { plan: { billingMode: { not: 'DIARIA' } } },
      },
      distinct: ['studentId'],
      orderBy: [{ paidAt: 'desc' }, { coverageEndsAt: 'desc' }],
      select: { studentId: true, coverageEndsAt: true },
    });
    const coberturaPorAluno = new Map(ultimosPagamentos.map((i) => [i.studentId, i.coverageEndsAt]));

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

    for (const { id, studentId } of assinaturas) {
      if (jaExistentes.has(id)) continue;

      try {
        // Quem pagou vence na cobertura do ultimo pagamento; quem nao tem
        // pagamento (ou tem fora da janela do mes) segue o `dueDay` (PI, 20/10/2026).
        const dueAt = vencimentoPelaCobertura(coberturaPorAluno.get(studentId) ?? null, competencia);

        await this.billing.abrirInvoiceDoPeriodo(contexto, {
          subscriptionId: id,
          emQue: agora,
          ...(dueAt ? { dueAt } : {}),
        });
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
