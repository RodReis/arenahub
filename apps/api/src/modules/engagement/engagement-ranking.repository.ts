import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { RankingCategory, RankingSnapshotStatus, StudentStatus } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { SaldoParaClassificar } from './domain/classificacao.js';
import type { DecisaoDeEngajamento } from './domain/participacao.js';
import { abreviarNome, type IdentidadeEscolhida, type StatusDoPerfilPublico } from './domain/exposicao.js';
import { inicioDaSemanaLocal } from './domain/semana-de-consistencia.js';

/** Token de injecao da porta -- o modulo Nest liga isto ao repositorio Prisma. */
export const PORTA_DE_RANKING = Symbol('PortaDeRanking');

/** Um snapshot de placar, na forma minima que o service consome. */
export interface SnapshotDeRanking {
  id: string;
  gymUnitId: string;
  category: RankingCategory;
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
  /** JA abreviado ("Ana S.") -- `DS-TOTEM.md` §3.4c/§5.8, nomes sempre
   * abreviados em tela publica e na area interna do totem. */
  nomeAbreviado: string;
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

/** Exposicao completa de um aluno especifico -- usado pelo placar AO VIVO
 * (`placarAoVivo`), que nao tem snapshot de onde tirar nome/perfil como
 * `entradasComExposicao` tira. Mesmos campos, so que indexado por
 * `studentId` em vez de vir amarrado a uma linha de snapshot. */
export interface ExposicaoDoAluno {
  studentId: string;
  decisao: DecisaoDeEngajamento | null;
  perfil: PerfilPublicoParaExposicao | null;
  /** JA abreviado ("Ana S.") -- mesma razao de `EntradaComExposicao.nomeAbreviado`. */
  nomeAbreviado: string;
  statusDoAluno: StudentStatus;
}

/** Uma unidade ativa e o fuso dela -- o que o job de fechamento mensal
 * (`EngagementRankingSchedulerService`) precisa para varrer todo tenant/
 * unidade e decidir, por unidade, qual e o `localMonth` anterior. */
export interface UnidadeParaFechamento {
  tenantId: string;
  gymUnitId: string;
  timezone: string;
}

/**
 * Gera, retem, publica e le o placar mensal.
 *
 * `TenantContext` e o PRIMEIRO argumento de todo metodo (INV-003, regra de
 * arquitetura no 2) -- inclusive nos metodos so-leitura. Porta PROPRIA,
 * separada de `PortaDeXp`: o placar precisa dos saldos de TODOS os alunos da
 * unidade num mes, e `PortaDeXp.saldoDoAluno` devolve um so aluno por vez.
 *
 * EXCECAO: `unidadesAtivasComTimezone` NAO recebe `TenantContext` -- e uma
 * varredura entre TODOS os tenants, o mesmo padrao de
 * `OperationsRepository.listarTenantsAtivos` (F11): quem chama e um JOB de
 * sistema, sem ator autenticado de tenant nenhum.
 */
export interface PortaDeRanking {
  coorteMinima(contexto: TenantContext): Promise<number>;
  saldosDaUnidade(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
    category: RankingCategory,
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
    category: RankingCategory,
  ): Promise<SnapshotDeRanking | null>;
  entradasComExposicao(
    contexto: TenantContext,
    snapshotId: string,
  ): Promise<readonly EntradaComExposicao[]>;
  exposicaoDosAlunos(
    contexto: TenantContext,
    studentIds: readonly string[],
  ): Promise<readonly ExposicaoDoAluno[]>;
  unidadesAtivasComTimezone(): Promise<readonly UnidadeParaFechamento[]>;
}

/** O que `salvarSnapshot` grava -- posicoes ja classificadas por `classificar()`. */
export interface EntradaParaSalvarSnapshot {
  gymUnitId: string;
  localMonth: string;
  category: RankingCategory;
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
   * O que classificar, na categoria pedida (F35, ADR-049 Decisao 4).
   *
   * Associacao aluno/unidade via `Student.gymUnitId` (unidade de MATRICULA),
   * nao via unidade das sessoes: o placar e uma feature social por unidade, e
   * a unidade de matricula e o dado estavel; a unidade da sessao exigiria
   * decidir "unidade dominante do mes" para quem treina em mais de uma.
   *
   * A CATEGORIA SO MUDA A FONTE DOS PONTOS. `classificar()` continua a mesma
   * funcao pura da F31: ela ordena `points` e desempata por `lastEntryAt` e
   * `studentId`, sem saber o que o numero significa. Foi por isso que a
   * categoria coube sem reescrever a classificacao.
   */
  async saldosDaUnidade(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
    category: RankingCategory = 'XP_DO_MES',
  ): Promise<SaldoParaClassificar[]> {
    if (category === 'XP_DO_MES') {
      return this.db.studentXpBalance.findMany({
        where: { tenantId: contexto.tenantId, localMonth, student: { gymUnitId } },
        select: { studentId: true, points: true, lastEntryAt: true },
      });
    }

    // FREQUENCIA e CONSISTENCIA saem da MESMA projecao: as sessoes da F24,
    // ja deduplicadas por `(tenant, aluno, dia local, unidade, politica)` no
    // indice unico. Contar sessao aqui e contar o que a catraca confirmou --
    // nao ha segunda contagem de presenca no sistema, e criar uma seria criar
    // uma verdade paralela capaz de divergir.
    const sessoes = await this.db.studentAttendanceSession.findMany({
      where: {
        tenantId: contexto.tenantId,
        gymUnitId,
        // `sessionDate` e `@db.Date` no fuso local da unidade -- comparar por
        // prefixo AAAA-MM aqui repetiria a conversao que a F24 ja fez.
        // Por isso a janela vem em Date, montada a partir do mes local.
        sessionDate: janelaDoMes(localMonth),
      },
      select: { studentId: true, sessionDate: true },
      orderBy: { sessionDate: 'asc' },
    });

    return category === 'FREQUENCIA'
      ? contarSessoes(sessoes)
      : contarSemanasDistintas(sessoes);
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
    // Regera o DRAFT/WITHHELD existente da mesma CATEGORIA:
    // `@@unique([tenantId, gymUnitId, localMonth, category])` permite um
    // snapshot por unidade, mes e categoria. O PUBLISHED nao chega aqui de
    // novo -- quem barra republicar e `publicarSnapshot`.
    //
    // A categoria no `where` NAO e detalhe: sem ela, gerar o placar de
    // frequencia de agosto apagaria o rascunho de XP de agosto, e o operador
    // so descobriria ao tentar publicar e nao achar.
    const criado = await this.db.$transaction(async (tx) => {
      await tx.rankingSnapshot.deleteMany({
        where: {
          tenantId: contexto.tenantId,
          gymUnitId: entrada.gymUnitId,
          localMonth: entrada.localMonth,
          category: entrada.category,
          status: { in: ['DRAFT', 'WITHHELD'] },
        },
      });

      return tx.rankingSnapshot.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: entrada.gymUnitId,
          localMonth: entrada.localMonth,
          category: entrada.category,
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
    category: RankingCategory = 'XP_DO_MES',
  ): Promise<SnapshotDeRanking | null> {
    const snapshot = await this.db.rankingSnapshot.findFirst({
      where: { tenantId: contexto.tenantId, gymUnitId, localMonth, category, status: 'PUBLISHED' },
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
      nomeAbreviado: abreviarNome(entrada.student.fullName),
      statusDoAluno: entrada.student.status,
    }));
  }

  /**
   * Exposicao completa (nome, perfil, decisao, status) dos `studentIds`
   * dados -- SEM snapshot, para o placar AO VIVO (`EngagementRankingService.
   * placarAoVivo`, Emenda de 27/08/2026). Mesma forma de `entradasComExposicao`,
   * so que a fonte da lista de alunos e o array dado, nao as linhas de um
   * snapshot ja gravado.
   */
  async exposicaoDosAlunos(
    contexto: TenantContext,
    studentIds: readonly string[],
  ): Promise<readonly ExposicaoDoAluno[]> {
    if (studentIds.length === 0) return [];

    const [alunos, decisaoPorAluno] = await Promise.all([
      this.db.student.findMany({
        where: { tenantId: contexto.tenantId, id: { in: [...studentIds] } },
        select: { id: true, fullName: true, status: true, publicProfile: true },
      }),
      this.decisaoDeRankingPorAluno(contexto, studentIds),
    ]);

    return alunos.map((aluno) => ({
      studentId: aluno.id,
      decisao: decisaoPorAluno.get(aluno.id) ?? null,
      perfil: aluno.publicProfile
        ? {
            alias: aluno.publicProfile.alias,
            status: aluno.publicProfile.status,
            identidade: aluno.publicProfile.identityChoice,
          }
        : null,
      nomeAbreviado: abreviarNome(aluno.fullName),
      statusDoAluno: aluno.status,
    }));
  }

  /**
   * Todas as unidades de tenant ATIVO, com o fuso de cada uma -- o job de
   * fechamento mensal (`EngagementRankingSchedulerService`) usa isto para
   * varrer e decidir, por unidade, qual e o `localMonth` ANTERIOR no fuso
   * DELA. Mesmo padrao de `OperationsRepository.listarTenantsAtivos` (F11):
   * sem `TenantContext`, e uma varredura de sistema.
   */
  async unidadesAtivasComTimezone(): Promise<readonly UnidadeParaFechamento[]> {
    const unidades = await this.db.gymUnit.findMany({
      where: { tenant: { status: 'ACTIVE' } },
      select: { tenantId: true, id: true, timezone: true },
    });

    return unidades.map((unidade) => ({
      tenantId: unidade.tenantId,
      gymUnitId: unidade.id,
      timezone: unidade.timezone,
    }));
  }
}

/** Converte a linha do Prisma (com `entries` incluidas) para `SnapshotDeRanking`. */
function paraSnapshot(linha: {
  id: string;
  gymUnitId: string;
  category: RankingCategory;
  status: RankingSnapshotStatus;
  publishedAt: Date | null;
  entries: { studentId: string; position: number; points: number }[];
}): SnapshotDeRanking {
  return {
    id: linha.id,
    gymUnitId: linha.gymUnitId,
    category: linha.category,
    status: linha.status,
    publishedAt: linha.publishedAt,
    entries: linha.entries.map((entrada) => ({
      studentId: entrada.studentId,
      position: entrada.position,
      points: entrada.points,
    })),
  };
}

/**
 * Janela `[primeiro dia, primeiro dia do mes seguinte)` do mes local.
 *
 * Meia-aberta de proposito: `lte` no ultimo dia depende de o `@db.Date` nao
 * carregar hora, e basta um registro com hora para o ultimo dia do mes sumir
 * do placar. `lt` no primeiro dia do mes seguinte nao tem essa aresta.
 */
function janelaDoMes(localMonth: string): { gte: Date; lt: Date } {
  const [ano, mes] = localMonth.split('-').map(Number) as [number, number];

  return {
    gte: new Date(Date.UTC(ano, mes - 1, 1)),
    lt: new Date(Date.UTC(ano, mes, 1)),
  };
}

/** `AAAA-MM-DD` do `@db.Date`, sem reconverter fuso -- a F24 ja gravou local. */
function diaLocal(sessionDate: Date): string {
  return sessionDate.toISOString().slice(0, 10);
}

interface SessaoParaContagem {
  studentId: string;
  sessionDate: Date;
}

/** Quantas sessoes confirmadas o aluno teve no mes -- categoria FREQUENCIA. */
function contarSessoes(sessoes: readonly SessaoParaContagem[]): SaldoParaClassificar[] {
  const porAluno = new Map<string, { points: number; lastEntryAt: Date }>();

  for (const sessao of sessoes) {
    const atual = porAluno.get(sessao.studentId);
    // `lastEntryAt` e o desempate 2 de `classificar()`: quem chegou ao numero
    // PRIMEIRO ganha, entao guarda-se a sessao mais RECENTE de cada aluno --
    // e ela que diz quando ele fechou a contagem do mes.
    porAluno.set(sessao.studentId, {
      points: (atual?.points ?? 0) + 1,
      lastEntryAt:
        atual && atual.lastEntryAt > sessao.sessionDate ? atual.lastEntryAt : sessao.sessionDate,
    });
  }

  return [...porAluno].map(([studentId, dado]) => ({ studentId, ...dado }));
}

/**
 * Em quantas SEMANAS DISTINTAS o aluno treinou no mes -- categoria
 * CONSISTENCIA.
 *
 * Premia regularidade, nao volume: quem treina 3x por semana toda semana
 * ganha de quem treina 15x numa semana so e some. Reusa
 * `inicioDaSemanaLocal()` da F32 em vez de recalcular semana aqui -- duas
 * definicoes de "que semana e esta" divergiriam na virada de ano.
 */
function contarSemanasDistintas(
  sessoes: readonly SessaoParaContagem[],
): SaldoParaClassificar[] {
  const porAluno = new Map<string, { semanas: Set<string>; lastEntryAt: Date }>();

  for (const sessao of sessoes) {
    const atual = porAluno.get(sessao.studentId) ?? {
      semanas: new Set<string>(),
      lastEntryAt: sessao.sessionDate,
    };

    atual.semanas.add(inicioDaSemanaLocal(diaLocal(sessao.sessionDate)));
    if (sessao.sessionDate > atual.lastEntryAt) atual.lastEntryAt = sessao.sessionDate;

    porAluno.set(sessao.studentId, atual);
  }

  return [...porAluno].map(([studentId, dado]) => ({
    studentId,
    points: dado.semanas.size,
    lastEntryAt: dado.lastEntryAt,
  }));
}
