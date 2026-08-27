import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { RankingSnapshotStatus, StudentStatus } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { SaldoParaClassificar } from './domain/classificacao.js';
import type { DecisaoDeEngajamento } from './domain/participacao.js';
import type { IdentidadeEscolhida, StatusDoPerfilPublico } from './domain/exposicao.js';

/** Token de injecao da porta -- o modulo Nest liga isto ao repositorio Prisma. */
export const PORTA_DE_RANKING = Symbol('PortaDeRanking');

/** Um snapshot de placar, na forma minima que o service consome. */
export interface SnapshotDeRanking {
  id: string;
  status: RankingSnapshotStatus;
  publishedAt: Date | null;
  entries: readonly EntradaDeSnapshot[];
}

/** Uma linha ja gravada no snapshot -- pontuacao e posicao CONGELADAS. */
export interface EntradaDeSnapshot {
  studentId: string;
  position: number;
  points: number;
}

/** O que `entradasComExposicao` devolve: a entrada congelada + os dados de
 * exposicao ATUAIS do aluno (perfil, decisao, status) -- nunca gravados no
 * snapshot, porque mudam depois da publicacao (ver `EngagementRankingService`). */
export interface EntradaComExposicao {
  position: number;
  points: number;
  decisao: DecisaoDeEngajamento | null;
  perfil: PerfilPublicoParaExposicao | null;
  primeiroNome: string;
  statusDoAluno: StudentStatus;
}

export interface PerfilPublicoParaExposicao {
  alias: string | null;
  status: StatusDoPerfilPublico;
  identidade: IdentidadeEscolhida;
}

/** O minimo que `gerarSnapshot` precisa para decidir ELEGIBILIDADE (nao
 * exposicao completa -- na geracao nao ha nome nenhum a resolver, so decisao
 * de opt-out e status do aluno, que sao os dois criterios de `resolverExposicao`
 * que independem de PERFIL). */
export interface ElegibilidadeDoAluno {
  studentId: string;
  decisao: DecisaoDeEngajamento | null;
  statusDoAluno: StudentStatus;
}

/**
 * Gera, retem, publica e le o placar mensal.
 *
 * `TenantContext` e o PRIMEIRO argumento de todo metodo (INV-003, regra de
 * arquitetura no 2) -- inclusive nos metodos so-leitura. Porta PROPRIA,
 * separada de `PortaDeXp`: o placar precisa dos saldos de TODOS os alunos da
 * unidade num mes, e `PortaDeXp.saldoDoAluno` devolve um so aluno por vez.
 */
export interface PortaDeRanking {
  coorteMinima(contexto: TenantContext): Promise<number>;
  saldosDaUnidade(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
  ): Promise<SaldoParaClassificar[]>;
  elegibilidadeDosAlunos(
    contexto: TenantContext,
    studentIds: readonly string[],
  ): Promise<readonly ElegibilidadeDoAluno[]>;
  salvarSnapshot(
    contexto: TenantContext,
    entrada: EntradaParaSalvarSnapshot,
  ): Promise<SnapshotDeRanking>;
  snapshotPorId(contexto: TenantContext, snapshotId: string): Promise<SnapshotDeRanking | null>;
  publicarSnapshot(
    contexto: TenantContext,
    snapshotId: string,
    agora: Date,
  ): Promise<SnapshotDeRanking>;
  snapshotPublicado(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
  ): Promise<SnapshotDeRanking | null>;
  entradasComExposicao(
    contexto: TenantContext,
    snapshotId: string,
  ): Promise<readonly EntradaComExposicao[]>;
}

/** O que `salvarSnapshot` grava -- posicoes ja classificadas por `classificar()`. */
export interface EntradaParaSalvarSnapshot {
  gymUnitId: string;
  localMonth: string;
  status: RankingSnapshotStatus;
  minimumCohort: number;
  eligibleCount: number;
  generatedAt: Date;
  posicoes: readonly { studentId: string; position: number; points: number; lastEntryAt: Date }[];
}

@Injectable()
export class EngagementRankingRepository implements PortaDeRanking {
  constructor(private readonly db: PrismaService) {}

  async coorteMinima(contexto: TenantContext): Promise<number> {
    const tenant = await this.db.tenant.findUniqueOrThrow({
      where: { id: contexto.tenantId },
      select: { rankingMinimumCohort: true },
    });

    return tenant.rankingMinimumCohort;
  }

  /**
   * Saldos de todos os alunos da unidade no mes -- associacao aluno/unidade
   * via `Student.gymUnitId` (unidade de MATRICULA), nao via unidade das
   * sessoes que geraram o movimento. Ver decisao registrada no relatorio da
   * Task 8: o placar e uma feature social por unidade, e a unidade de
   * matricula e o dado estavel; a unidade da sessao exigiria decidir
   * "unidade dominante do mes" para aluno que treina em mais de uma, sem
   * ganho que justifique a complexidade nesta fatia.
   */
  async saldosDaUnidade(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
  ): Promise<SaldoParaClassificar[]> {
    const saldos = await this.db.studentXpBalance.findMany({
      where: {
        tenantId: contexto.tenantId,
        localMonth,
        student: { gymUnitId },
      },
      select: { studentId: true, points: true, lastEntryAt: true },
    });

    return saldos;
  }

  /**
   * Decisao de opt-out + status do aluno para os `studentIds` dados -- o
   * minimo para `gerarSnapshot` decidir ELEGIBILIDADE, sem buscar nome nem
   * perfil publico (que so importam na LEITURA, nunca na geracao).
   */
  async elegibilidadeDosAlunos(
    contexto: TenantContext,
    studentIds: readonly string[],
  ): Promise<readonly ElegibilidadeDoAluno[]> {
    if (studentIds.length === 0) return [];

    const [alunos, decisaoPorAluno] = await Promise.all([
      this.db.student.findMany({
        where: { tenantId: contexto.tenantId, id: { in: [...studentIds] } },
        select: { id: true, status: true },
      }),
      this.decisaoDeRankingPorAluno(contexto, studentIds),
    ]);

    return alunos.map((aluno) => ({
      studentId: aluno.id,
      decisao: decisaoPorAluno.get(aluno.id) ?? null,
      statusDoAluno: aluno.status,
    }));
  }

  /** Ultima decisao de RANKING vigente por aluno -- extraido para ser
   * compartilhado entre `elegibilidadeDosAlunos` e `entradasComExposicao`. */
  private async decisaoDeRankingPorAluno(
    contexto: TenantContext,
    studentIds: readonly string[],
  ): Promise<Map<string, DecisaoDeEngajamento>> {
    const decisoes = await this.db.consentRecord.findMany({
      where: {
        tenantId: contexto.tenantId,
        studentId: { in: [...studentIds] },
        supersededAt: null,
        document: { type: 'RANKING' },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      select: { studentId: true, decision: true, supersededAt: true },
    });

    // A ultima decisao vigente por aluno -- `orderBy` acima garante que a
    // PRIMEIRA ocorrencia no array e a mais recente (memoria
    // sort-estavel-decide-consentimento).
    const decisaoPorAluno = new Map<string, DecisaoDeEngajamento>();
    for (const decisao of decisoes) {
      if (!decisaoPorAluno.has(decisao.studentId)) {
        decisaoPorAluno.set(decisao.studentId, {
          decision: decisao.decision,
          supersededAt: decisao.supersededAt,
        });
      }
    }

    return decisaoPorAluno;
  }

  async salvarSnapshot(
    contexto: TenantContext,
    entrada: EntradaParaSalvarSnapshot,
  ): Promise<SnapshotDeRanking> {
    // Regera o DRAFT/WITHHELD existente: `@@unique([tenantId, gymUnitId,
    // localMonth])` permite so um snapshot por unidade e mes. O PUBLISHED
    // nao chega aqui de novo -- quem barra republicar e `publicarSnapshot`.
    const criado = await this.db.$transaction(async (tx) => {
      await tx.rankingSnapshot.deleteMany({
        where: {
          tenantId: contexto.tenantId,
          gymUnitId: entrada.gymUnitId,
          localMonth: entrada.localMonth,
          status: { in: ['DRAFT', 'WITHHELD'] },
        },
      });

      return tx.rankingSnapshot.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: entrada.gymUnitId,
          localMonth: entrada.localMonth,
          status: entrada.status,
          minimumCohort: entrada.minimumCohort,
          eligibleCount: entrada.eligibleCount,
          generatedAt: entrada.generatedAt,
          entries: {
            create: entrada.posicoes.map((posicao) => ({
              position: posicao.position,
              studentId: posicao.studentId,
              points: posicao.points,
              lastEntryAt: posicao.lastEntryAt,
            })),
          },
        },
        include: { entries: true },
      });
    });

    return paraSnapshot(criado);
  }

  async snapshotPorId(contexto: TenantContext, snapshotId: string): Promise<SnapshotDeRanking | null> {
    const snapshot = await this.db.rankingSnapshot.findFirst({
      where: { id: snapshotId, tenantId: contexto.tenantId },
      include: { entries: true },
    });

    return snapshot ? paraSnapshot(snapshot) : null;
  }

  async publicarSnapshot(
    contexto: TenantContext,
    snapshotId: string,
    agora: Date,
  ): Promise<SnapshotDeRanking> {
    // Compare-and-swap contra o status: so publica quem ainda nao foi
    // publicado. `M5-AC-007` -- o snapshot e imutavel depois de PUBLISHED.
    const resultado = await this.db.rankingSnapshot.updateMany({
      where: { id: snapshotId, tenantId: contexto.tenantId, status: { not: 'PUBLISHED' } },
      data: { status: 'PUBLISHED', publishedAt: agora },
    });

    if (resultado.count === 0) {
      /*
       * O CAS pode ter falhado por dois motivos bem diferentes: o snapshot
       * nao existe neste tenant (404), ou existe e ja esta PUBLISHED
       * (`M5-AC-007`, 409 -- republicar e recusado, nao erro do cliente).
       * Antes disto os dois casos viravam `Error` crua, que o
       * `ProblemDetailsFilter` so sabe traduzir como 500 -- a politica de
       * imutabilidade "recusava" derrubando a requisicao com erro interno.
       */
      const existente = await this.db.rankingSnapshot.findFirst({
        where: { id: snapshotId, tenantId: contexto.tenantId },
        select: { id: true },
      });

      if (!existente) {
        throw new NotFoundException({
          code: 'RANKING_SNAPSHOT_NAO_ENCONTRADO',
          message: 'RANKING_SNAPSHOT_NAO_ENCONTRADO',
        });
      }

      throw new ConflictException({
        code: 'RANKING_SNAPSHOT_IMUTAVEL',
        message: 'RANKING_SNAPSHOT_IMUTAVEL',
      });
    }

    const publicado = await this.db.rankingSnapshot.findFirst({
      where: { id: snapshotId, tenantId: contexto.tenantId },
      include: { entries: true },
    });

    if (!publicado) {
      throw new NotFoundException({
        code: 'RANKING_SNAPSHOT_NAO_ENCONTRADO',
        message: 'RANKING_SNAPSHOT_NAO_ENCONTRADO',
      });
    }

    return paraSnapshot(publicado);
  }

  async snapshotPublicado(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
  ): Promise<SnapshotDeRanking | null> {
    const snapshot = await this.db.rankingSnapshot.findFirst({
      where: { tenantId: contexto.tenantId, gymUnitId, localMonth, status: 'PUBLISHED' },
      include: { entries: true },
    });

    return snapshot ? paraSnapshot(snapshot) : null;
  }

  /**
   * Entradas do snapshot (posicao/pontos CONGELADOS) + exposicao ATUAL de
   * cada aluno. `resolverExposicao()` roda no service, na leitura -- nunca
   * aqui na materializacao. Ver o comentario de `lerPlacarPublicado`.
   */
  async entradasComExposicao(
    contexto: TenantContext,
    snapshotId: string,
  ): Promise<readonly EntradaComExposicao[]> {
    const entradas = await this.db.rankingEntry.findMany({
      where: { snapshotId, snapshot: { tenantId: contexto.tenantId } },
      orderBy: { position: 'asc' },
      include: {
        student: {
          select: {
            fullName: true,
            status: true,
            publicProfile: true,
          },
        },
      },
    });

    const decisaoPorAluno = await this.decisaoDeRankingPorAluno(
      contexto,
      entradas.map((entrada) => entrada.studentId),
    );

    return entradas.map((entrada) => ({
      position: entrada.position,
      points: entrada.points,
      decisao: decisaoPorAluno.get(entrada.studentId) ?? null,
      perfil: entrada.student.publicProfile
        ? {
            alias: entrada.student.publicProfile.alias,
            status: entrada.student.publicProfile.status,
            identidade: entrada.student.publicProfile.identityChoice,
          }
        : null,
      primeiroNome: primeiroNomeDe(entrada.student.fullName),
      statusDoAluno: entrada.student.status,
    }));
  }
}

/** Primeiro nome, a partir do nome completo -- mesma extracao de `engagement.service.ts`. */
function primeiroNomeDe(fullName: string): string {
  return fullName.trim().split(/\s+/u)[0] ?? fullName;
}

/** Converte a linha do Prisma (com `entries` incluidas) para `SnapshotDeRanking`. */
function paraSnapshot(linha: {
  id: string;
  status: RankingSnapshotStatus;
  publishedAt: Date | null;
  entries: { studentId: string; position: number; points: number }[];
}): SnapshotDeRanking {
  return {
    id: linha.id,
    status: linha.status,
    publishedAt: linha.publishedAt,
    entries: linha.entries.map((entrada) => ({
      studentId: entrada.studentId,
      position: entrada.position,
      points: entrada.points,
    })),
  };
}
