import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { EfeitoAdverso, ParticipanteDoExperimento } from './domain/analise-itt.js';
import type { GrupoDoExperimento } from './domain/randomizacao.js';

export const PORTA_DE_EXPERIMENTOS = Symbol('PortaDeExperimentos');

export interface ExperimentoAtivo {
  readonly id: string;
  readonly label: string;
  readonly semente: string;
  readonly fracaoDeControle: number;
  readonly janelaEmDias: number;
}

export interface AlocacaoGravada {
  readonly studentId: string;
  readonly grupo: GrupoDoExperimento;
  readonly alocadoEm: Date;
}

export interface AlocacaoParaGravar {
  readonly experimentoId: string;
  readonly studentId: string;
  readonly grupo: GrupoDoExperimento;
  readonly alocadoEm: Date;
}

export type ParticipanteBruto = ParticipanteDoExperimento;

export interface PortaDeExperimentos {
  experimentoAtivo(contexto: TenantContext): Promise<ExperimentoAtivo | null>;
  alocacoesDoExperimento(
    contexto: TenantContext,
    experimentoId: string,
  ): Promise<AlocacaoGravada[]>;
  gravarAlocacao(
    contexto: TenantContext,
    entrada: AlocacaoParaGravar,
  ): Promise<{ criada: boolean }>;
  participantesParaAnalise(
    contexto: TenantContext,
    experimentoId: string,
  ): Promise<ParticipanteBruto[]>;
}

const GRUPO_PARA_BANCO: Record<GrupoDoExperimento, string> = {
  CONTROLE: 'CONTROL',
  TRATAMENTO: 'TREATMENT',
};

const GRUPO_DO_BANCO: Record<string, GrupoDoExperimento> = {
  CONTROL: 'CONTROLE',
  TREATMENT: 'TRATAMENTO',
};

const EFEITO_DO_BANCO: Record<string, EfeitoAdverso> = {
  OPT_OUT: 'OPT_OUT',
  CANCELLED: 'CANCELOU',
  DECLINED: 'RECUSOU',
  SUPPRESSION_REQUESTED: 'SUPRESSAO_SOLICITADA',
};

const MILISSEGUNDOS_POR_DIA = 86_400_000;

/** `P2002` sem `instanceof`: o erro cruza fronteira de módulo e perde o protótipo. */
function erroDeUnicidade(erro: unknown): boolean {
  return (
    typeof erro === 'object' &&
    erro !== null &&
    'code' in erro &&
    (erro as { code?: unknown }).code === 'P2002'
  );
}

@Injectable()
export class RetentionExperimentsRepository implements PortaDeExperimentos {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * O experimento em execução do tenant.
   *
   * No máximo um por vez, por decisão de desenho: dois experimentos
   * simultâneos sobre a mesma base cruzariam os braços — um aluno no controle
   * de A e no tratamento de B recebe ligação, e o controle de A deixa de ser
   * controle. Medir dois efeitos ao mesmo tempo exigiria desenho fatorial, que
   * esta fatia não entrega.
   */
  async experimentoAtivo(contexto: TenantContext): Promise<ExperimentoAtivo | null> {
    const experimento = await this.prisma.retentionExperiment.findFirst({
      where: { tenantId: contexto.tenantId, status: 'RUNNING' },
      // Desempate por id: dois iniciados no mesmo instante deixariam a ordem
      // física do Postgres escolher, e ela muda depois de um UPDATE.
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    });

    if (experimento === null) {
      return null;
    }

    return {
      id: experimento.id,
      label: experimento.label,
      semente: experimento.seed,
      fracaoDeControle: Number(experimento.controlFraction),
      janelaEmDias: experimento.windowDays,
    };
  }

  async alocacoesDoExperimento(
    contexto: TenantContext,
    experimentoId: string,
  ): Promise<AlocacaoGravada[]> {
    const alocacoes = await this.prisma.retentionExperimentAssignment.findMany({
      where: { tenantId: contexto.tenantId, experimentId: experimentoId },
      select: { studentId: true, assignedGroup: true, assignedAt: true },
    });

    return alocacoes.map((a) => ({
      studentId: a.studentId,
      grupo: GRUPO_DO_BANCO[a.assignedGroup] ?? 'TRATAMENTO',
      alocadoEm: a.assignedAt,
    }));
  }

  async gravarAlocacao(
    contexto: TenantContext,
    entrada: AlocacaoParaGravar,
  ): Promise<{ criada: boolean }> {
    try {
      await this.prisma.retentionExperimentAssignment.create({
        data: {
          tenantId: contexto.tenantId,
          experimentId: entrada.experimentoId,
          studentId: entrada.studentId,
          assignedGroup: GRUPO_PARA_BANCO[entrada.grupo] as never,
          // Explícito, não `@default(now())`: a janela conta daqui, e misturar
          // o relógio da aplicação com o do banco foi o defeito da F38.
          assignedAt: entrada.alocadoEm,
        },
        select: { id: true },
      });

      return { criada: true };
    } catch (erro) {
      // A chave única encontrou quem já estava alocado. Não é falha: realocar
      // seria mudança de grupo, que `M6-FR-012` proíbe.
      if (erroDeUnicidade(erro)) {
        return { criada: false };
      }
      throw erro;
    }
  }

  /**
   * Os participantes com desfecho medido, para a análise ITT.
   *
   * A janela é por ALUNO, contada da alocação dele. Contar do início do
   * experimento mediria 30 dias para quem entrou no primeiro dia e 10 para quem
   * entrou no vigésimo — e a diferença apareceria como efeito.
   *
   * Só entram alunos cuja janela já FECHOU. Incluir quem ainda está dentro dela
   * infla a permanência dos dois braços (ninguém teve tempo de sair) e diluiria
   * qualquer efeito real.
   */
  async participantesParaAnalise(
    contexto: TenantContext,
    experimentoId: string,
  ): Promise<ParticipanteBruto[]> {
    const experimento = await this.prisma.retentionExperiment.findFirst({
      where: { id: experimentoId, tenantId: contexto.tenantId },
      select: { windowDays: true },
    });

    if (experimento === null) {
      return [];
    }

    const agora = Date.now();
    const janelaEmMs = experimento.windowDays * MILISSEGUNDOS_POR_DIA;

    const alocacoes = await this.prisma.retentionExperimentAssignment.findMany({
      where: { tenantId: contexto.tenantId, experimentId: experimentoId },
      orderBy: { studentId: 'asc' },
      include: {
        student: {
          select: {
            status: true,
            subscriptions: {
              where: { tenantId: contexto.tenantId },
              orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
              take: 1,
              select: { status: true },
            },
          },
        },
      },
    });

    const fechadas = alocacoes.filter(
      (a) => agora - a.assignedAt.getTime() >= janelaEmMs,
    );

    if (fechadas.length === 0) {
      return [];
    }

    const studentIds = fechadas.map((a) => a.studentId);

    // Uma consulta para os contatos e outra para os adversos, em vez de N+1.
    const contatados = await this.prisma.retentionInteraction.findMany({
      where: { tenantId: contexto.tenantId, task: { studentId: { in: studentIds } } },
      select: { task: { select: { studentId: true } } },
    });
    const comContato = new Set(contatados.map((c) => c.task.studentId));

    const adversos = await this.prisma.retentionExperimentAdverseEvent.findMany({
      where: {
        tenantId: contexto.tenantId,
        experimentId: experimentoId,
        studentId: { in: studentIds },
      },
      select: { studentId: true, effect: true },
    });
    const porAluno = new Map<string, EfeitoAdverso[]>();
    for (const adverso of adversos) {
      const efeito = EFEITO_DO_BANCO[adverso.effect];
      if (efeito === undefined) continue;
      const lista = porAluno.get(adverso.studentId);
      if (lista === undefined) {
        porAluno.set(adverso.studentId, [efeito]);
      } else {
        lista.push(efeito);
      }
    }

    return fechadas.map((a) => {
      const assinatura = a.student.subscriptions[0]?.status;

      return {
        studentId: a.studentId,
        grupo: GRUPO_DO_BANCO[a.assignedGroup] ?? 'TRATAMENTO',
        // Permanência = ainda tem assinatura viva e não foi arquivado. É a
        // métrica primária que o PI escolheu em 31/08/2026.
        permaneceu:
          a.student.status !== 'ARCHIVED' &&
          (assinatura === 'ACTIVE' || assinatura === 'PAST_DUE' || assinatura === 'PAUSED'),
        contatado: comContato.has(a.studentId),
        adversos: porAluno.get(a.studentId) ?? [],
      };
    });
  }
}
