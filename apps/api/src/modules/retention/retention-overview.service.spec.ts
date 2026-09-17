import { beforeEach, describe, expect, it } from '@jest/globals';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { RetentionOverviewService } from './retention-overview.service.js';
import { RetentionMonitoringService } from './retention-monitoring.service.js';
import { RetentionScoresQueryService } from './retention-scores-query.service.js';
import { RetentionTasksQueryService } from './retention-tasks-query.service.js';
import type { PortaDeMonitoramento, EstadoDoScoring, ResumoDePeriodo } from './retention-monitoring.repository.js';
import type { PortaDeConsultaDeScores, ScoreGravado } from './retention-scores-query.service.js';
import type { PortaDeConsultaDeTarefas, TarefaNaFila } from './retention-tasks-query.service.js';
import type { FaixaDeRisco } from './domain/avaliar-baseline.js';
import type { EstadoDeTarefa } from './domain/tarefa-de-retencao.js';

const contexto: TenantContext = {
  tenantId: 't1',
  actorId: 'a1',
  sessionId: 's1',
  permissions: new Set<string>(),
  allowedUnitIds: 'ALL',
};

const agora = new Date('2026-09-10T12:00:00.000Z');

class PortaDeMonitoramentoFake implements PortaDeMonitoramento {
  estadoDoScoring(): Promise<EstadoDoScoring> {
    return Promise.resolve({ ligado: true, ultimoSnapshotEm: new Date('2026-09-10T04:00:00.000Z') });
  }
  resumoDoPeriodo(): Promise<ResumoDePeriodo[]> {
    return Promise.resolve([]);
  }
  definirScoring(): Promise<void> {
    return Promise.resolve();
  }
}

class PortaDeScoresFake implements PortaDeConsultaDeScores {
  contagem: Record<FaixaDeRisco, number> = { BAIXO: 0, MEDIO: 0, ALTO: 0, CRITICO: 0 };
  filaDeRisco(): Promise<ScoreGravado[]> {
    return Promise.resolve([]);
  }
  historicoDoAluno(): Promise<ScoreGravado[]> {
    return Promise.resolve([]);
  }
  contagemPorBanda(): Promise<Record<FaixaDeRisco, number>> {
    return Promise.resolve(this.contagem);
  }
}

class PortaDeTarefasFake implements PortaDeConsultaDeTarefas {
  contagem: Partial<Record<EstadoDeTarefa, number>> = {};
  filaDeTarefas(): Promise<TarefaNaFila[]> {
    return Promise.resolve([]);
  }
  contagemPorEstado(): Promise<Partial<Record<EstadoDeTarefa, number>>> {
    return Promise.resolve(this.contagem);
  }
}

describe('RetentionOverviewService', () => {
  let monitoramento: PortaDeMonitoramentoFake;
  let scoresPorta: PortaDeScoresFake;
  let tarefasPorta: PortaDeTarefasFake;
  let service: RetentionOverviewService;

  beforeEach(() => {
    monitoramento = new PortaDeMonitoramentoFake();
    scoresPorta = new PortaDeScoresFake();
    tarefasPorta = new PortaDeTarefasFake();

    service = new RetentionOverviewService(
      new RetentionMonitoringService(monitoramento),
      new RetentionScoresQueryService(scoresPorta),
      new RetentionTasksQueryService(tarefasPorta),
    );
  });

  it('repassa a contagem por banda e por estado, direto das portas', async () => {
    scoresPorta.contagem = { BAIXO: 1, MEDIO: 0, ALTO: 2, CRITICO: 1 };
    tarefasPorta.contagem = { ABERTA: 2, CONCLUIDA: 1 };

    const visao = await service.visaoGeral(contexto, agora);

    expect(visao.filaDeRisco).toEqual({ BAIXO: 1, MEDIO: 0, ALTO: 2, CRITICO: 1 });
    expect(visao.filaDeTarefas).toEqual({ ABERTA: 2, CONCLUIDA: 1 });
  });

  /**
   * Guarda o achado do code review: a contagem NUNCA pode vir de somar uma
   * página limitada. Com centenas de scores, `contagemPorBanda` ainda precisa
   * refletir o total real -- este teste prova que o service não trunca nada
   * por conta própria, só repassa o que a porta devolveu.
   */
  it('nao trunca a contagem mesmo com numero grande de scores', async () => {
    scoresPorta.contagem = { BAIXO: 300, MEDIO: 120, ALTO: 45, CRITICO: 9 };

    const visao = await service.visaoGeral(contexto, agora);

    expect(visao.filaDeRisco).toEqual({ BAIXO: 300, MEDIO: 120, ALTO: 45, CRITICO: 9 });
  });

  it('sem score nem tarefa, devolve zeros e nenhuma chave de tarefa', async () => {
    const visao = await service.visaoGeral(contexto, agora);

    expect(visao.filaDeRisco).toEqual({ BAIXO: 0, MEDIO: 0, ALTO: 0, CRITICO: 0 });
    expect(visao.filaDeTarefas).toEqual({});
  });

  it('reporta o estado do pipeline vindo do monitoramento', async () => {
    const visao = await service.visaoGeral(contexto, agora);

    expect(visao.pipeline.estado).toBe('SAUDAVEL');
  });
});
