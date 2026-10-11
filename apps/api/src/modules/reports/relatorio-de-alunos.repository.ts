import { Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { FATURA_PAGA, faturaVencidaEmAberto } from '../billing/domain/criterios-financeiros.js';
import type {
  FiltroDoRelatorioDeAlunos,
  LinhaDoRelatorioDeAlunos,
} from './domain/filtro-do-relatorio-de-alunos.js';
import { rotuloDoPlano } from './domain/formato-brasileiro.js';

/**
 * O `where` do relatório. UM só, usado por `contar` e `listar`: o total do
 * cabeçalho e as linhas da tela/arquivo respondem à mesma pergunta por
 * construção -- o mesmo motivo de `condicoesDaListagem` na Lista de Alunos.
 *
 * PERFIL VAZIO = TODOS. A Lista de Alunos fixa `profile = STUDENT`; aqui o
 * relatório tem filtro de perfil, e fixar um padrão esconderia professor e
 * funcionário de quem não mexeu no filtro.
 *
 * PLANO = o da assinatura VIGENTE (`ACTIVE`/`PAST_DUE`), o mesmo que a coluna
 * Plano mostra. Acesso por vínculo (cortesia etc.) não tem `planId`.
 */
export function ondeDoRelatorio(
  tenantId: string,
  filtro: FiltroDoRelatorioDeAlunos,
  agora: Date,
): Prisma.StudentWhereInput {
  return {
    tenantId,
    ...(filtro.profile ? { profile: filtro.profile } : {}),
    ...(filtro.gymUnitId ? { gymUnitId: filtro.gymUnitId } : {}),
    ...(filtro.status ? { status: filtro.status } : {}),
    ...(filtro.planId
      ? { subscriptions: { some: { planId: filtro.planId, status: { in: ['ACTIVE', 'PAST_DUE'] } } } }
      : {}),
    ...(filtro.financeiro === 'INADIMPLENTES'
      ? { invoices: { some: faturaVencidaEmAberto(agora) } }
      : {}),
    ...(filtro.financeiro === 'PAGANTES' ? { invoices: { some: FATURA_PAGA } } : {}),
  };
}

/**
 * O que a linha precisa -- e nada além. Mesmos critérios de "assinatura
 * vigente", "telefone principal" e "vínculo vigente" de `includeDaListagem`
 * (`students/student.repository.ts`), de propósito: a coluna Plano e a coluna
 * Contato do relatório têm de dizer o que a Lista de Alunos diz. O teste de
 * integração fixa os três casos (assinatura, vínculo, nada).
 */
function selecao(agora: Date) {
  return {
    id: true,
    fullName: true,
    cpf: true,
    credentials: { orderBy: { createdAt: 'asc' }, select: { externalId: true } },
    contacts: {
      where: { type: 'PHONE' },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
      take: 1,
      select: { value: true },
    },
    subscriptions: {
      where: { status: { in: ['ACTIVE', 'PAST_DUE'] } },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: 1,
      select: { plan: { select: { name: true } } },
    },
    entitlements: {
      where: { subscriptionId: null, status: 'ACTIVE', startsAt: { lte: agora }, endsAt: { gte: agora } },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: 1,
      select: { source: true },
    },
  } satisfies Prisma.StudentSelect;
}

type AlunoLido = Prisma.StudentGetPayload<{ select: ReturnType<typeof selecao> }>;

function paraLinha(aluno: AlunoLido): LinhaDoRelatorioDeAlunos {
  return {
    studentId: aluno.id,
    deviceIds: [...new Set(aluno.credentials.map((c) => c.externalId))],
    fullName: aluno.fullName,
    cpf: aluno.cpf,
    phone: aluno.contacts[0]?.value ?? null,
    planLabel: rotuloDoPlano(
      aluno.subscriptions[0]?.plan.name ?? null,
      aluno.entitlements[0]?.source ?? null,
    ),
  };
}

@Injectable()
export class RelatorioDeAlunosRepository {
  constructor(private readonly db: PrismaService) {}

  async contar(contexto: TenantContext, filtro: FiltroDoRelatorioDeAlunos, agora: Date): Promise<number> {
    return this.db.comTenant((tx) =>
      tx.student.count({ where: ondeDoRelatorio(contexto.tenantId, filtro, agora) }),
    );
  }

  /**
   * Ordem por nome com `id` de desempate: sem chave estável, dois alunos com o
   * mesmo nome trocam de lugar entre páginas e o cursor repete ou pula gente.
   */
  async listar(
    contexto: TenantContext,
    filtro: FiltroDoRelatorioDeAlunos,
    agora: Date,
    janela: { limite: number; cursor?: string | undefined },
  ): Promise<LinhaDoRelatorioDeAlunos[]> {
    const alunos = await this.db.comTenant((tx) =>
      tx.student.findMany({
        where: ondeDoRelatorio(contexto.tenantId, filtro, agora),
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        take: janela.limite,
        ...(janela.cursor ? { cursor: { id: janela.cursor }, skip: 1 } : {}),
        select: selecao(agora),
      }),
    );

    return alunos.map(paraLinha);
  }
}
