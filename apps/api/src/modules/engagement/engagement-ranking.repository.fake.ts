import type { RankingSnapshotStatus, StudentStatus } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { SaldoParaClassificar } from './domain/classificacao.js';
import type { DecisaoDeEngajamento } from './domain/participacao.js';
import type { IdentidadeEscolhida, StatusDoPerfilPublico } from './domain/exposicao.js';
import type {
  ElegibilidadeDoAluno,
  EntradaComExposicao,
  EntradaParaSalvarSnapshot,
  PortaDeRanking,
  SnapshotDeRanking,
} from './engagement-ranking.repository.js';

/** Snapshot guardado em memoria, com as entradas (posicao/pontos congelados). */
interface SnapshotEmMemoria {
  id: string;
  tenantId: string;
  gymUnitId: string;
  localMonth: string;
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

  /** So do dublê: define a coorte minima do tenant (`Tenant.rankingMinimumCohort`). */
  comCoorteMinima(minimo: number): void {
    this.minimoDeCoorte = minimo;
  }

  /** So do dublê: popula os saldos de XP dos alunos de uma unidade/mes. */
  comSaldos(gymUnitId: string, localMonth: string, saldos: readonly SaldoParaClassificar[]): void {
    this.saldos.set(chave(gymUnitId, localMonth), [...saldos]);

    // Aluno default ACTIVE com nome derivado do id, so para os testes que
    // nao chamam `comAluno` explicitamente (ex.: geracao de coorte).
    for (const saldo of saldos) {
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
  ): Promise<SaldoParaClassificar[]> {
    return Promise.resolve([...(this.saldos.get(chave(gymUnitId, localMonth)) ?? [])]);
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
    // Regera o DRAFT/WITHHELD existente da mesma unidade/mes -- mesmo
    // comportamento do repositorio real (so um snapshot nao-publicado por
    // unidade/mes).
    for (const [id, existente] of this.snapshots) {
      if (
        existente.tenantId === contexto.tenantId &&
        existente.gymUnitId === entrada.gymUnitId &&
        existente.localMonth === entrada.localMonth &&
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
      return Promise.reject(new Error('RANKING_SNAPSHOT_NAO_ENCONTRADO'));
    }

    if (snapshot.status === 'PUBLISHED') {
      return Promise.reject(new Error('RANKING_SNAPSHOT_IMUTAVEL'));
    }

    snapshot.status = 'PUBLISHED';
    snapshot.publishedAt = agora;
    return Promise.resolve(paraSnapshot(snapshot));
  }

  snapshotPublicado(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
  ): Promise<SnapshotDeRanking | null> {
    for (const snapshot of this.snapshots.values()) {
      if (
        snapshot.tenantId === contexto.tenantId &&
        snapshot.gymUnitId === gymUnitId &&
        snapshot.localMonth === localMonth &&
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
          primeiroNome: primeiroNomeDe(aluno?.fullName ?? entrada.studentId),
          statusDoAluno: aluno?.status ?? 'ACTIVE',
        };
      }),
    );
  }
}

function chave(gymUnitId: string, localMonth: string): string {
  return `${gymUnitId}::${localMonth}`;
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function primeiroNomeDe(fullName: string): string {
  return fullName.trim().split(/\s+/u)[0] ?? fullName;
}

function paraSnapshot(snapshot: SnapshotEmMemoria): SnapshotDeRanking {
  return {
    id: snapshot.id,
    status: snapshot.status,
    publishedAt: snapshot.publishedAt,
    entries: snapshot.entries.map((entrada) => ({ ...entrada })),
  };
}
