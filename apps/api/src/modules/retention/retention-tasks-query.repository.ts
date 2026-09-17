import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { FaixaDeRisco } from './domain/avaliar-baseline.js';
import type { EstadoDeTarefa, ResultadoDeTarefa } from './domain/tarefa-de-retencao.js';
import type {
  PortaDeConsultaDeTarefas,
  TarefaNaFila,
} from './retention-tasks-query.service.js';

const ESTADO_DO_BANCO: Record<string, EstadoDeTarefa> = {
  OPEN: 'ABERTA',
  ASSIGNED: 'ATRIBUIDA',
  IN_PROGRESS: 'EM_ATENDIMENTO',
  COMPLETED: 'CONCLUIDA',
  DISMISSED: 'DISPENSADA',
  EXPIRED: 'EXPIRADA',
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

@Injectable()
export class RetentionTasksQueryRepository implements PortaDeConsultaDeTarefas {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A fila, com o motivo e o histórico de tentativa junto.
   *
   * Traz score, fatores e interações num `include` só: a tela mostra os três
   * lado a lado, e buscá-los depois viraria N+1 na página que `M6-NFR-004`
   * exige em menos de 1s.
   *
   * `orderBy` explícito em cada `include`: o Postgres não promete ordem, e a
   * F36 já perdeu tempo com `include` embaralhando linha após `UPDATE`. Aqui
   * trocaria o primeiro fator -- que é o que a atendente lê para abrir a
   * conversa -- e a ordem das tentativas de contato.
   */
  async filaDeTarefas(contexto: TenantContext, limite: number): Promise<TarefaNaFila[]> {
    const tarefas = await this.prisma.retentionTask.findMany({
      where: { tenantId: contexto.tenantId },
      // Ativas primeiro (`OPEN` < `ASSIGNED` < ... não é alfabético, então a
      // ordenação de trabalho é pelo prazo): vence antes, aparece antes.
      // Desempate por id para não deixar a ordem física decidir.
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: limite,
      include: {
        score: {
          select: {
            id: true,
            value: true,
            band: true,
            factors: { orderBy: { position: 'asc' } },
          },
        },
        interactions: { orderBy: { occurredAt: 'asc' } },
      },
    });

    return tarefas.map((tarefa) => ({
      taskId: tarefa.id,
      studentId: tarefa.studentId,
      gymUnitId: tarefa.gymUnitId,
      estrategia: tarefa.strategy,
      estado: ESTADO_DO_BANCO[tarefa.status] ?? 'ABERTA',
      responsavelId: tarefa.assigneeId,
      resultado: tarefa.result === null ? null : (RESULTADO_DO_BANCO[tarefa.result] ?? null),
      motivo: tarefa.dismissReason,
      venceEm: tarefa.dueAt,
      criadaEm: tarefa.createdAt,
      score: {
        scoreId: tarefa.score.id,
        valor: tarefa.score.value,
        faixa: FAIXA_DO_BANCO[tarefa.score.band] ?? 'BAIXO',
      },
      fatores: tarefa.score.factors.map((fator) => ({
        posicao: fator.position,
        feature: fator.featureName,
        valorObservado: Number(fator.observedValue),
        rotulo: fator.label,
      })),
      interacoes: tarefa.interactions.map((interacao) => ({
        canal: interacao.channel,
        resultado: RESULTADO_DO_BANCO[interacao.result] ?? 'CONTATADO',
        actorId: interacao.actorId,
        ocorreuEm: interacao.occurredAt,
        observacoes: interacao.notes,
        proximoPasso: interacao.nextStep,
      })),
    }));
  }

  /** `groupBy` no banco, sem `take` -- mesma população de `filaDeTarefas`. */
  async contagemPorEstado(
    contexto: TenantContext,
  ): Promise<Readonly<Partial<Record<EstadoDeTarefa, number>>>> {
    const grupos = await this.prisma.retentionTask.groupBy({
      by: ['status'],
      where: { tenantId: contexto.tenantId },
      _count: { _all: true },
    });

    return grupos.reduce<Partial<Record<EstadoDeTarefa, number>>>((contagem, grupo) => {
      const estado = ESTADO_DO_BANCO[grupo.status];
      if (estado === undefined) return contagem;
      return { ...contagem, [estado]: grupo._count._all };
    }, {});
  }
}
