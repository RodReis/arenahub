import { comContexto } from '@arenahub/database';

import type { PrismaService } from '../../persistence/prisma.service.js';
import type { ContagemDeAlunos } from './domain/calculo-da-fatura.js';

/**
 * Quantos alunos a academia tem, ativos e inativos -- a contagem que a fatura
 * e o contrato leem.
 *
 * MODULO PROPRIO, e nao metodo de um dos dois casos de uso: a fatura ja
 * depende do contrato (`PlatformInvoiceUseCase` injeta
 * `TenantContractUseCase`), e o contrato passou a precisar da contagem para
 * imprimir o valor apurado no PDF (F70). Injetar a fatura de volta fecharia um
 * ciclo de dependencia no Nest.
 *
 * INATIVO E POR COMPLEMENTO -- `total - ativos`, e nao uma lista de status.
 * Um status novo no enum cai em inativo sozinho, em vez de sumir da conta e
 * fazer a fatura sair a menos sem nada falhar (ADR-052 §6).
 *
 * `comTenant`: `students` tem politica RLS (F66) e, fora de transacao
 * interceptada, o `set_config` nunca aplica -- sob o role restrito as duas
 * contagens voltam ZERO e a fatura do SaaS sai a MENOS, sem que nada falhe
 * (issue #306). Uma transacao so para os dois, e nao duas.
 *
 * `comContexto` EXPLICITO, e nao so o do interceptor: o
 * `PlatformInvoiceSchedulerService` emite a fatura por `@Cron`, onde nao ha
 * requisicao HTTP e o interceptor nunca roda. Pior, o job captura a excecao
 * por tenant e a transforma em log para nao derrubar os demais -- entao, sem
 * este escopo, o faturamento mensal inteiro erraria para menos uma vez por
 * tenant, com o processo terminando "com sucesso".
 *
 * `system` e nao `platform`: a contagem e de UM tenant, dado no argumento, e
 * nao atravessa nenhum outro. `platform` e a excecao ao isolamento, reservada
 * a quem le entre tenants (ADR-052 §3) -- usa-lo aqui pediria mais alcance do
 * que a operacao precisa.
 *
 * Aninhar sobre o escopo que o interceptor ja abriu na rota e inofensivo:
 * `comContexto` e `AsyncLocalStorage`, o de dentro vence enquanto dura, e os
 * dois nomeiam o mesmo tenant.
 */
export async function contarAlunosDoTenant(
  db: PrismaService,
  tenantId: string,
): Promise<ContagemDeAlunos> {
  const [total, ativos] = await comContexto({ kind: 'system', tenantId }, () =>
    db.comTenant((tx) =>
      Promise.all([
        tx.student.count({ where: { tenantId } }),
        tx.student.count({ where: { tenantId, status: 'ACTIVE' } }),
      ]),
    ),
  );

  return { ativos, inativos: total - ativos };
}
