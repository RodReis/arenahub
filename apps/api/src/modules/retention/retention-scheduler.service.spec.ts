import { beforeEach, describe, expect, it } from '@jest/globals';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { RecorteDeSnapshot } from './domain/janela-as-of.js';
import type { SnapshotDeFeatures } from './domain/snapshot.js';
import { RetentionSchedulerService } from './retention-scheduler.service.js';
import type { PortaDeUnidadesDeRetencao, UnidadeParaRetencao } from './retention-scheduler.repository.js';
import type { RetentionSnapshotsService } from './retention-snapshots.service.js';
import type { RetentionScoresService, ResumoDaRodada } from './retention-scores.service.js';
import type { RetentionTasksService, ResumoDaFila } from './retention-tasks.service.js';

/** Meia-noite UTC -- fuso America/Sao_Paulo (UTC-3) cai no mesmo dia civil. */
const PRIMEIRO_DE_SETEMBRO = new Date('2026-09-01T03:00:00.000Z');

class PortaDeUnidadesFake implements PortaDeUnidadesDeRetencao {
  constructor(private unidades: readonly UnidadeParaRetencao[]) {}

  unidadesAtivasComTimezone(): Promise<readonly UnidadeParaRetencao[]> {
    return Promise.resolve(this.unidades);
  }
}

class SnapshotsFake {
  chamadasDeCalcular = 0;
  elegiveisPorTenant: readonly string[] = ['aluno-1', 'aluno-2'];

  elegiveis(_contexto: TenantContext, _observadoEm: Date): Promise<string[]> {
    return Promise.resolve([...this.elegiveisPorTenant]);
  }

  calcular(
    _contexto: TenantContext,
    _studentId: string,
    _recorte: RecorteDeSnapshot,
    _versoes: { alvo: string; features: string },
  ): Promise<SnapshotDeFeatures> {
    this.chamadasDeCalcular += 1;
    return Promise.resolve({} as SnapshotDeFeatures);
  }
}

class ScoresFake {
  chamadas = 0;
  falharNaChamada: number | null = null;
  travarAte: Promise<void> | null = null;

  async pontuarDia(_contexto: TenantContext, _observadoEm: Date): Promise<ResumoDaRodada> {
    this.chamadas += 1;
    if (this.travarAte !== null) await this.travarAte;
    if (this.falharNaChamada === this.chamadas) throw new Error('falha simulada');
    return { pontuados: 2, pulados: 0 };
  }
}

class TasksFake {
  chamadas = 0;

  gerarFila(_contexto: TenantContext, _agora: Date): Promise<ResumoDaFila> {
    this.chamadas += 1;
    return Promise.resolve({ criadas: 1, suprimidas: 0 });
  }
}

describe('RetentionSchedulerService', () => {
  let unidades: PortaDeUnidadesFake;
  let snapshots: SnapshotsFake;
  let scores: ScoresFake;
  let tasks: TasksFake;

  function montarJob(): RetentionSchedulerService {
    return new RetentionSchedulerService(
      unidades,
      snapshots as unknown as RetentionSnapshotsService,
      scores as unknown as RetentionScoresService,
      tasks as unknown as RetentionTasksService,
    );
  }

  beforeEach(() => {
    unidades = new PortaDeUnidadesFake([
      { tenantId: 't1', gymUnitId: 'u1', timezone: 'America/Sao_Paulo' },
    ]);
    snapshots = new SnapshotsFake();
    scores = new ScoresFake();
    tasks = new TasksFake();
  });

  it('fecha snapshot, score e fila de um tenant ativo', async () => {
    const resultado = await montarJob().executarCiclo(PRIMEIRO_DE_SETEMBRO);

    expect(resultado).toEqual({ tenants: 1, processados: 1, falhas: 0 });
    expect(snapshots.chamadasDeCalcular).toBe(2);
    expect(scores.chamadas).toBe(1);
    expect(tasks.chamadas).toBe(1);
  });

  it('sem aluno elegivel, ainda pontua e gera fila (idempotente por construcao)', async () => {
    snapshots.elegiveisPorTenant = [];

    const resultado = await montarJob().executarCiclo(PRIMEIRO_DE_SETEMBRO);

    expect(resultado).toEqual({ tenants: 1, processados: 1, falhas: 0 });
    expect(snapshots.chamadasDeCalcular).toBe(0);
    expect(scores.chamadas).toBe(1);
  });

  it('duas unidades do mesmo tenant processam o tenant uma unica vez', async () => {
    unidades = new PortaDeUnidadesFake([
      { tenantId: 't1', gymUnitId: 'u1', timezone: 'America/Sao_Paulo' },
      { tenantId: 't1', gymUnitId: 'u2', timezone: 'America/Sao_Paulo' },
    ]);

    const resultado = await montarJob().executarCiclo(PRIMEIRO_DE_SETEMBRO);

    expect(resultado).toEqual({ tenants: 1, processados: 1, falhas: 0 });
    expect(scores.chamadas).toBe(1);
  });

  it('falha em um tenant nao impede os outros', async () => {
    unidades = new PortaDeUnidadesFake([
      { tenantId: 't1', gymUnitId: 'u1', timezone: 'America/Sao_Paulo' },
      { tenantId: 't2', gymUnitId: 'u2', timezone: 'America/Sao_Paulo' },
    ]);
    scores.falharNaChamada = 1;

    const resultado = await montarJob().executarCiclo(PRIMEIRO_DE_SETEMBRO);

    expect(resultado).toEqual({ tenants: 2, processados: 1, falhas: 1 });
  });

  it('trava de reentrada: ciclo em curso ignora o proximo tick', async () => {
    let resolverPrimeiro: () => void = () => {};
    scores.travarAte = new Promise<void>((resolve) => {
      resolverPrimeiro = resolve;
    });

    const job = montarJob();

    const primeiro = job.executarCicloComTrava();
    await job.executarCicloComTrava();

    resolverPrimeiro();
    await primeiro;

    expect(scores.chamadas).toBe(1);
  });
});
