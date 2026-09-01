import { ConflictException, NotFoundException } from '@nestjs/common';
import type { RankingCategory, RankingSnapshotStatus, StudentStatus } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { SaldoParaClassificar } from './domain/classificacao.js';
import type { DecisaoDeEngajamento } from './domain/participacao.js';
import { abreviarNome, type IdentidadeEscolhida, type StatusDoPerfilPublico } from './domain/exposicao.js';
import type {
  ElegibilidadeDoAluno,
  EntradaComExposicao,
  EntradaInternaDoPlacar,
  EntradaParaSalvarSnapshot,
  ExposicaoDoAluno,
  PortaDeRanking,
  SnapshotDeRanking,
  UnidadeParaFechamento,
} from './engagement-ranking.repository.js';

/** Snapshot guardado em memoria, com as entradas (posicao/pontos congelados). */
interface SnapshotEmMemoria {
  id: string;
  tenantId: string;
  gymUnitId: string;
  localMonth: string;
  category: RankingCategory;
  status: RankingSnapshotStatus;
  publishedAt: Date | null;
  entries: { studentId: string; position: number; points: number }[];
}

/** Dado de aluno para exposicao -- nome civil e status. */
interface AlunoDeTeste {
  fullName: string;
  status: StudentStatus;
}

/**
 * Dublê de `PortaDeRanking` em memoria.
 *
 * Instancia NOVA por teste (`new FakePortaDeRanking()` num `beforeEach`) --
 * instancia compartilhada vaza estado entre casos (memoria
 * duble-com-estado-vaza-entre-testes).
 */
export class FakePortaDeRanking implements PortaDeRanking {
  private minimoDeCoorte = 5;
  private readonly saldos = new Map<string, SaldoParaClassificar[]>();
  private readonly snapshots = new Map<string, SnapshotEmMemoria>();
  private readonly optOuts = new Set<string>();
  private readonly alunos = new Map<string, AlunoDeTeste>();
  private readonly perfis = new Map<
    string,
    { alias: string | null; status: StatusDoPerfilPublico; identidade: IdentidadeEscolhida }
  >();
  private proximoId = 1;

  /** So do dublê: quantas vezes `saldosDaUnidade` foi chamado -- prova do
   * cache do placar AO VIVO (`EngagementRankingService.placarAoVivo`). Sem
   * contar chamadas ao repositorio, o cache pode nao estar funcionando e
   * o teste passaria do mesmo jeito. */
  chamadasASaldosDaUnidade = 0;

  /** So do dublê: unidades ativas que `unidadesAtivasComTimezone` devolve --
   * o job de fechamento mensal varre isto. */
  private readonly unidades: UnidadeParaFechamento[] = [];

  /** So do dublê: define a coorte minima do tenant (`Tenant.rankingMinimumCohort`). */
  comCoorteMinima(minimo: number): void {
    this.minimoDeCoorte = minimo;
  }

  /** So do dublê: popula os saldos de XP dos alunos de uma unidade/mes. */
  comSaldos(gymUnitId: string, localMonth: string, saldos: readonly SaldoParaClassificar[]): void {
    this.popular('XP_DO_MES', gymUnitId, localMonth, saldos);
  }

  /** So do dublê: popula as sessoes do mes (categoria FREQUENCIA, F35). */
  comFrequencia(
    gymUnitId: string,
    localMonth: string,
    valores: readonly SaldoParaClassificar[],
  ): void {
    this.popular('FREQUENCIA', gymUnitId, localMonth, valores);
  }

  /** So do dublê: popula as semanas elegiveis (categoria CONSISTENCIA, F35). */
  comConsistencia(
    gymUnitId: string,
    localMonth: string,
    valores: readonly SaldoParaClassificar[],
  ): void {
    this.popular('CONSISTENCIA', gymUnitId, localMonth, valores);
  }

  private popular(
    category: RankingCategory,
    gymUnitId: string,
    localMonth: string,
    valores: readonly SaldoParaClassificar[],
  ): void {
    this.saldos.set(chave(gymUnitId, localMonth, category), [...valores]);

    // Aluno default ACTIVE com nome derivado do id, so para os testes que
    // nao chamam `comAluno` explicitamente (ex.: geracao de coorte).
    for (const saldo of valores) {
      if (!this.alunos.has(saldo.studentId)) {
        this.alunos.set(saldo.studentId, {
          fullName: `${capitalizar(saldo.studentId)} Teste`,
          status: 'ACTIVE',
        });
      }
    }
  }

  /** So do dublê: define o nome civil de um aluno. */
  comAluno(studentId: string, fullName: string): void {
    const atual = this.alunos.get(studentId);
    this.alunos.set(studentId, { fullName, status: atual?.status ?? 'ACTIVE' });
  }

  /** So do dublê: marca o aluno como opt-out de ranking (REFUSED vigente). */
  comOptOut(studentId: string): void {
    this.optOuts.add(studentId);
  }

  /** So do dublê: marca o aluno como inativo (`StudentStatus` != ACTIVE). */
  comAlunoInativo(studentId: string): void {
    const atual = this.alunos.get(studentId);
    this.alunos.set(studentId, { fullName: atual?.fullName ?? studentId, status: 'SUSPENDED' });
  }

  /** So do dublê: perfil publico com apelido APROVADO. */
  comApelidoAprovado(studentId: string, alias: string): void {
    this.perfis.set(studentId, { alias, status: 'APPROVED', identidade: 'APELIDO' });
  }

  /** So do dublê: perfil publico com apelido PENDENTE de moderacao. */
  comApelidoPendente(studentId: string, alias: string): void {
    this.perfis.set(studentId, { alias, status: 'PENDING', identidade: 'APELIDO' });
  }

  /** So do dublê: registra uma unidade ativa para `unidadesAtivasComTimezone`
   * -- o que o job de fechamento mensal varre. */
  comUnidadeAtiva(tenantId: string, gymUnitId: string, timezone: string): void {
    this.unidades.push({ tenantId, gymUnitId, timezone });
  }

  /** So do dublê: le as entradas cruas do snapshot -- prova que a
   * materializacao nao foi tocada por opt-out feito apos a publicacao. */
  entradasDoSnapshot(
    snapshotId: string,
  ): Promise<{ studentId: string; position: number; points: number }[]> {
    const snapshot = this.snapshots.get(snapshotId);
    return Promise.resolve(snapshot ? [...snapshot.entries] : []);
  }

  coorteMinima(_contexto: TenantContext): Promise<number> {
    return Promise.resolve(this.minimoDeCoorte);
  }

  saldosDaUnidade(
    _contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
    category: RankingCategory = 'XP_DO_MES',
  ): Promise<SaldoParaClassificar[]> {
    this.chamadasASaldosDaUnidade += 1;
    return Promise.resolve([...(this.saldos.get(chave(gymUnitId, localMonth, category)) ?? [])]);
  }

  elegibilidadeDosAlunos(
    _contexto: TenantContext,
    studentIds: readonly string[],
  ): Promise<readonly ElegibilidadeDoAluno[]> {
    return Promise.resolve(
      studentIds.map((studentId) => {
        const aluno = this.alunos.get(studentId);
        const decisao: DecisaoDeEngajamento | null = this.optOuts.has(studentId)
          ? { decision: 'REFUSED', supersededAt: null }
          : null;

        return { studentId, decisao, statusDoAluno: aluno?.status ?? 'ACTIVE' };
      }),
    );
  }

  salvarSnapshot(
    contexto: TenantContext,
    entrada: EntradaParaSalvarSnapshot,
  ): Promise<SnapshotDeRanking> {
    // Regera o DRAFT/WITHHELD existente da mesma unidade/mes E CATEGORIA --
    // mesmo comportamento do repositorio real. A categoria no criterio nao e
    // detalhe: sem ela, gerar o placar de frequencia de agosto APAGARIA o
    // rascunho de XP de agosto, e o operador so descobriria ao publicar.
    for (const [id, existente] of this.snapshots) {
      if (
        existente.tenantId === contexto.tenantId &&
        existente.gymUnitId === entrada.gymUnitId &&
        existente.localMonth === entrada.localMonth &&
        existente.category === entrada.category &&
        existente.status !== 'PUBLISHED'
      ) {
        this.snapshots.delete(id);
      }
    }

    const id = `snapshot-${this.proximoId++}`;
    const snapshot: SnapshotEmMemoria = {
      id,
      tenantId: contexto.tenantId,
      gymUnitId: entrada.gymUnitId,
      localMonth: entrada.localMonth,
      category: entrada.category,
      status: entrada.status,
      publishedAt: null,
      entries: entrada.posicoes.map((posicao) => ({
        studentId: posicao.studentId,
        position: posicao.position,
        points: posicao.points,
      })),
    };

    this.snapshots.set(id, snapshot);
    return Promise.resolve(paraSnapshot(snapshot));
  }

  snapshotPorId(contexto: TenantContext, snapshotId: string): Promise<SnapshotDeRanking | null> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot || snapshot.tenantId !== contexto.tenantId) return Promise.resolve(null);

    return Promise.resolve(paraSnapshot(snapshot));
  }

  publicarSnapshot(
    contexto: TenantContext,
    snapshotId: string,
    agora: Date,
  ): Promise<SnapshotDeRanking> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot || snapshot.tenantId !== contexto.tenantId) {
      return Promise.reject(
        new NotFoundException({
          code: 'RANKING_SNAPSHOT_NAO_ENCONTRADO',
          message: 'RANKING_SNAPSHOT_NAO_ENCONTRADO',
        }),
      );
    }

    if (snapshot.status === 'PUBLISHED') {
      return Promise.reject(
        new ConflictException({
          code: 'RANKING_SNAPSHOT_IMUTAVEL',
          message: 'RANKING_SNAPSHOT_IMUTAVEL',
        }),
      );
    }

    snapshot.status = 'PUBLISHED';
    snapshot.publishedAt = agora;
    return Promise.resolve(paraSnapshot(snapshot));
  }

  snapshotPublicado(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
    category: RankingCategory = 'XP_DO_MES',
  ): Promise<SnapshotDeRanking | null> {
    for (const snapshot of this.snapshots.values()) {
      if (
        snapshot.tenantId === contexto.tenantId &&
        snapshot.gymUnitId === gymUnitId &&
        snapshot.localMonth === localMonth &&
        snapshot.category === category &&
        snapshot.status === 'PUBLISHED'
      ) {
        return Promise.resolve(paraSnapshot(snapshot));
      }
    }

    return Promise.resolve(null);
  }

  entradasComExposicao(
    contexto: TenantContext,
    snapshotId: string,
  ): Promise<readonly EntradaComExposicao[]> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot || snapshot.tenantId !== contexto.tenantId) return Promise.resolve([]);

    return Promise.resolve(
      snapshot.entries.map((entrada) => {
        const aluno = this.alunos.get(entrada.studentId);
        const perfil = this.perfis.get(entrada.studentId) ?? null;
        const decisao: DecisaoDeEngajamento | null = this.optOuts.has(entrada.studentId)
          ? { decision: 'REFUSED', supersededAt: null }
          : null;

        return {
          position: entrada.position,
          points: entrada.points,
          decisao,
          perfil,
          nomeAbreviado: abreviarNome(aluno?.fullName ?? entrada.studentId),
          statusDoAluno: aluno?.status ?? 'ACTIVE',
        };
      }),
    );
  }

  /**
   * Espelha `entradasInternas`: nome REAL, sem alias e sem abreviacao.
   *
   * O dublê nao pode abreviar aqui -- se abreviasse, o teste que prova
   * "o painel mostra nome inteiro" passaria com o fake e falharia contra o
   * banco, que e o pior tipo de verde.
   */
  entradasInternas(
    contexto: TenantContext,
    snapshotId: string,
  ): Promise<readonly EntradaInternaDoPlacar[]> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot || snapshot.tenantId !== contexto.tenantId) return Promise.resolve([]);

    return Promise.resolve(
      snapshot.entries.map((entrada) => ({
        position: entrada.position,
        points: entrada.points,
        studentId: entrada.studentId,
        fullName: this.alunos.get(entrada.studentId)?.fullName ?? entrada.studentId,
      })),
    );
  }

  /** Espelha `entradasComExposicao`, mas para qualquer lista de `studentIds`
   * -- o placar AO VIVO nao tem snapshot de onde partir. */
  exposicaoDosAlunos(
    _contexto: TenantContext,
    studentIds: readonly string[],
  ): Promise<readonly ExposicaoDoAluno[]> {
    return Promise.resolve(
      studentIds.flatMap((studentId) => {
        const aluno = this.alunos.get(studentId);
        if (!aluno) return [];

        const perfil = this.perfis.get(studentId) ?? null;
        const decisao: DecisaoDeEngajamento | null = this.optOuts.has(studentId)
          ? { decision: 'REFUSED', supersededAt: null }
          : null;

        return [
          {
            studentId,
            decisao,
            perfil,
            nomeAbreviado: abreviarNome(aluno.fullName),
            statusDoAluno: aluno.status,
          },
        ];
      }),
    );
  }

  unidadesAtivasComTimezone(): Promise<readonly UnidadeParaFechamento[]> {
    return Promise.resolve([...this.unidades]);
  }
}

function chave(gymUnitId: string, localMonth: string, category: RankingCategory): string {
  return `${gymUnitId}::${localMonth}::${category}`;
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function paraSnapshot(snapshot: SnapshotEmMemoria): SnapshotDeRanking {
  return {
    id: snapshot.id,
    gymUnitId: snapshot.gymUnitId,
    category: snapshot.category,
    status: snapshot.status,
    publishedAt: snapshot.publishedAt,
    entries: snapshot.entries.map((entrada) => ({ ...entrada })),
  };
}
