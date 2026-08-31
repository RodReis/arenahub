import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { FaixaDeRisco } from './domain/avaliar-baseline.js';
import {
  ESTADOS_ATIVOS,
  type EstadoDeTarefa,
  type ResultadoDeTarefa,
} from './domain/tarefa-de-retencao.js';

export const PORTA_DE_TAREFAS = Symbol('PortaDeTarefas');

/** O PI fixou WhatsApp como canal único em 31/08/2026. */
export type CanalDeContato = 'WHATSAPP';

export interface PoliticaDeCapacidade {
  readonly gymUnitId: string;
  readonly capacidadeDiaria: number;
  readonly cooldownEmDias: number;
  readonly slaEmDiasUteis: number;
}

export interface CandidatoDoDia {
  readonly studentId: string;
  readonly gymUnitId: string;
  readonly scoreId: string;
  readonly valor: number;
  readonly faixa: FaixaDeRisco;
  readonly estrategia: string;
  readonly temTarefaAtiva: boolean;
  readonly ultimaTarefaEm: Date | null;
}

export interface TarefaParaCriar {
  readonly studentId: string;
  readonly gymUnitId: string;
  readonly scoreId: string;
  readonly estrategia: string;
  readonly venceEm: Date;
  /**
   * Quando a rodada considera que a tarefa nasceu.
   *
   * EXPLÍCITO, e não `@default(now())` do banco: o cooldown compara
   * `agora - createdAt`, e se um lado vem do relógio da aplicação e o outro do
   * relógio do Postgres, a conta mistura duas fontes. Reprocessar um dia
   * passado então mediria contra o instante da reexecução, não contra o dia
   * reprocessado -- e `M6-AC-004` promete que reprocessar dá o mesmo resultado.
   */
  readonly criadaEm: Date;
}

export interface TarefaGravada {
  readonly id: string;
  readonly estado: EstadoDeTarefa;
  readonly responsavelId: string | null;
  readonly resultado: ResultadoDeTarefa | null;
  readonly motivo: string | null;
}

export interface InteracaoParaRegistrar {
  readonly taskId: string;
  readonly actorId: string;
  readonly canal: CanalDeContato;
  readonly resultado: ResultadoDeTarefa;
  readonly observacoes: string | null;
  readonly proximoPasso: string | null;
}

export interface PortaDeTarefas {
  politicasDoTenant(contexto: TenantContext): Promise<PoliticaDeCapacidade[]>;
  candidatosDoDia(contexto: TenantContext, agora: Date): Promise<CandidatoDoDia[]>;
  criarTarefa(contexto: TenantContext, entrada: TarefaParaCriar): Promise<{ criada: boolean }>;
  carregarTarefa(contexto: TenantContext, taskId: string): Promise<TarefaGravada | null>;
  salvarTarefa(contexto: TenantContext, taskId: string, tarefa: TarefaGravada): Promise<void>;
  registrarInteracao(contexto: TenantContext, entrada: InteracaoParaRegistrar): Promise<void>;
}

const ESTADO_PARA_BANCO: Record<EstadoDeTarefa, string> = {
  ABERTA: 'OPEN',
  ATRIBUIDA: 'ASSIGNED',
  EM_ATENDIMENTO: 'IN_PROGRESS',
  CONCLUIDA: 'COMPLETED',
  DISPENSADA: 'DISMISSED',
  EXPIRADA: 'EXPIRED',
};

const ESTADO_DO_BANCO: Record<string, EstadoDeTarefa> = {
  OPEN: 'ABERTA',
  ASSIGNED: 'ATRIBUIDA',
  IN_PROGRESS: 'EM_ATENDIMENTO',
  COMPLETED: 'CONCLUIDA',
  DISMISSED: 'DISPENSADA',
  EXPIRED: 'EXPIRADA',
};

const RESULTADO_PARA_BANCO: Record<ResultadoDeTarefa, string> = {
  CONTATADO: 'CONTACTED',
  SEM_RESPOSTA: 'NO_ANSWER',
  CANAL_INDISPONIVEL: 'CHANNEL_UNAVAILABLE',
  RECUSOU: 'DECLINED',
  RETORNAR_DEPOIS: 'FOLLOW_UP',
  RESOLVIDO_DE_OUTRO_MODO: 'RESOLVED_OTHER',
};

const RESULTADO_DO_BANCO: Record<string, ResultadoDeTarefa> = {
  CONTACTED: 'CONTATADO',
  NO_ANSWER: 'SEM_RESPOSTA',
  CHANNEL_UNAVAILABLE: 'CANAL_INDISPONIVEL',
  DECLINED: 'RECUSOU',
  FOLLOW_UP: 'RETORNAR_DEPOIS',
  RESOLVED_OTHER: 'RESOLVIDO_DE_OUTRO_MODO',
};

const FAIXA_DO_BANCO: Record<string, FaixaDeRisco> = {
  LOW: 'BAIXO',
  MEDIUM: 'MEDIO',
  HIGH: 'ALTO',
  CRITICAL: 'CRITICO',
};

/**
 * A estratégia derivada do fator dominante.
 *
 * O cooldown é por (aluno, ESTRATÉGIA), então o mesmo aluno pode ser contatado
 * por queda de frequência e, semanas depois, por cobrança vencida -- são
 * conversas diferentes. Derivar do primeiro fator (o de maior peso, que a F37
 * já gravou em `position: 1`) mantém a estratégia colada ao motivo que a tela
 * mostra: a atendente lê o mesmo texto que decidiu a fila.
 */
const ESTRATEGIA_SEM_FATOR = 'RISCO_GERAL';

function estrategiaDoFator(feature: string | undefined): string {
  if (feature === undefined) {
    // Score alto sem fator é possível quando toda regra que dispararia caiu em
    // feature ausente. Vale contato, mas não há motivo específico a citar.
    return ESTRATEGIA_SEM_FATOR;
  }
  return feature.toUpperCase();
}

/** `P2002` sem `instanceof`: o erro cruza fronteira de módulo e perde o protótipo. */
function erroDeUnicidade(erro: unknown): boolean {
  return (
    typeof erro === 'object' &&
    erro !== null &&
    'code' in erro &&
    (erro as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Leitura e escrita da fila de tarefas (F38).
 *
 * ---------------------------------------------------------------------------
 * A CHAVE ÚNICA DECIDE A DUPLICATA, NÃO UM `if`
 * ---------------------------------------------------------------------------
 *
 * Mesma lição da F36 e da F37: `findFirst`-depois-`create` perde a corrida por
 * construção. Aqui há DUAS garantias, e elas cobrem coisas diferentes:
 * `@@unique(score_id)` impede que um score gere duas tarefas, e o índice
 * PARCIAL `(tenant, aluno, estratégia) WHERE status ativo` impede que dois
 * scores de dias diferentes gerem duas tarefas ativas pelo mesmo motivo. Sem o
 * segundo, o aluno recebe duas ligações -- o pipeline roda todo dia.
 */
@Injectable()
export class RetentionTasksRepository implements PortaDeTarefas {
  constructor(private readonly prisma: PrismaService) {}

  async politicasDoTenant(contexto: TenantContext): Promise<PoliticaDeCapacidade[]> {
    const politicas = await this.prisma.retentionCapacityPolicy.findMany({
      where: { tenantId: contexto.tenantId },
      orderBy: { gymUnitId: 'asc' },
    });

    return politicas.map((politica) => ({
      gymUnitId: politica.gymUnitId,
      capacidadeDiaria: politica.dailyCapacity,
      cooldownEmDias: politica.cooldownDays,
      slaEmDiasUteis: politica.slaBusinessDays,
    }));
  }

  /**
   * Os candidatos do dia mais recente que tem score.
   *
   * O dia sai de consulta própria, não de `new Date()`: o pipeline roda de
   * madrugada e pode atrasar, e assumir "hoje" devolveria fila vazia justamente
   * na manhã em que o job travou. Mesma escolha da leitura da F37.
   */
  async candidatosDoDia(contexto: TenantContext, _agora: Date): Promise<CandidatoDoDia[]> {
    const ultimo = await this.prisma.retentionScore.findFirst({
      where: { tenantId: contexto.tenantId },
      orderBy: { observedAt: 'desc' },
      select: { observedAt: true },
    });

    if (ultimo === null) {
      return [];
    }

    const scores = await this.prisma.retentionScore.findMany({
      where: { tenantId: contexto.tenantId, observedAt: ultimo.observedAt },
      orderBy: [{ value: 'desc' }, { id: 'asc' }],
      include: {
        factors: { orderBy: { position: 'asc' }, take: 1 },
        student: { select: { gymUnitId: true } },
      },
    });

    // Uma consulta para todas as tarefas dos alunos do dia, em vez de N+1.
    const tarefas = await this.prisma.retentionTask.findMany({
      where: {
        tenantId: contexto.tenantId,
        studentId: { in: scores.map((score) => score.studentId) },
      },
      orderBy: { createdAt: 'desc' },
      select: { studentId: true, strategy: true, status: true, createdAt: true },
    });

    const ativosNoBanco = new Set(ESTADOS_ATIVOS.map((estado) => ESTADO_PARA_BANCO[estado]));

    return scores.map((score) => {
      const estrategia = estrategiaDoFator(score.factors[0]?.featureName);
      // Cooldown e duplicata são por (aluno, ESTRATÉGIA): tarefa de cobrança não
      // segura a de frequência, que é outra conversa.
      const doAluno = tarefas.filter(
        (tarefa) => tarefa.studentId === score.studentId && tarefa.strategy === estrategia,
      );

      return {
        studentId: score.studentId,
        gymUnitId: score.student.gymUnitId,
        scoreId: score.id,
        valor: score.value,
        faixa: FAIXA_DO_BANCO[score.band] ?? 'BAIXO',
        estrategia,
        temTarefaAtiva: doAluno.some((tarefa) => ativosNoBanco.has(tarefa.status)),
        // `tarefas` já vem ordenada por `createdAt desc`, e `filter` preserva a
        // ordem -- a primeira é a mais recente.
        ultimaTarefaEm: doAluno[0]?.createdAt ?? null,
      };
    });
  }

  async criarTarefa(
    contexto: TenantContext,
    entrada: TarefaParaCriar,
  ): Promise<{ criada: boolean }> {
    try {
      await this.prisma.retentionTask.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: entrada.gymUnitId,
          studentId: entrada.studentId,
          scoreId: entrada.scoreId,
          strategy: entrada.estrategia,
          status: 'OPEN',
          dueAt: entrada.venceEm,
          createdAt: entrada.criadaEm,
        },
        select: { id: true },
      });

      return { criada: true };
    } catch (erro) {
      // Qualquer das duas chaves (score único, ou a parcial de ativa por
      // aluno+estratégia) significa a mesma coisa aqui: já existe. Não é falha.
      if (erroDeUnicidade(erro)) {
        return { criada: false };
      }
      throw erro;
    }
  }

  async carregarTarefa(
    contexto: TenantContext,
    taskId: string,
  ): Promise<TarefaGravada | null> {
    const tarefa = await this.prisma.retentionTask.findFirst({
      where: { id: taskId, tenantId: contexto.tenantId },
      select: {
        id: true,
        status: true,
        assigneeId: true,
        result: true,
        dismissReason: true,
      },
    });

    if (tarefa === null) {
      return null;
    }

    return {
      id: tarefa.id,
      estado: ESTADO_DO_BANCO[tarefa.status] ?? 'ABERTA',
      responsavelId: tarefa.assigneeId,
      resultado: tarefa.result === null ? null : (RESULTADO_DO_BANCO[tarefa.result] ?? null),
      motivo: tarefa.dismissReason,
    };
  }

  async salvarTarefa(
    contexto: TenantContext,
    taskId: string,
    tarefa: TarefaGravada,
  ): Promise<void> {
    await this.prisma.retentionTask.update({
      // `updateMany`-como-guarda não serve: precisamos falhar se o tenant não
      // bate, e `update` por id já foi precedido do `findFirst` com tenant.
      where: { id: taskId },
      data: {
        status: ESTADO_PARA_BANCO[tarefa.estado] as never,
        assigneeId: tarefa.responsavelId,
        result:
          tarefa.resultado === null ? null : (RESULTADO_PARA_BANCO[tarefa.resultado] as never),
        dismissReason: tarefa.motivo,
        completedAt: tarefa.estado === 'CONCLUIDA' ? new Date() : null,
      },
    });
  }

  async registrarInteracao(
    contexto: TenantContext,
    entrada: InteracaoParaRegistrar,
  ): Promise<void> {
    await this.prisma.retentionInteraction.create({
      data: {
        tenantId: contexto.tenantId,
        taskId: entrada.taskId,
        actorId: entrada.actorId,
        channel: entrada.canal,
        result: RESULTADO_PARA_BANCO[entrada.resultado] as never,
        notes: entrada.observacoes,
        nextStep: entrada.proximoPasso,
      },
    });
  }
}
