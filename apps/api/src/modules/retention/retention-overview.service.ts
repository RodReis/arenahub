import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { FaixaDeRisco } from './domain/avaliar-baseline.js';
import type { EstadoDeTarefa } from './domain/tarefa-de-retencao.js';
import type { SaudeDoPipeline } from './domain/saude-do-pipeline.js';
import { RetentionMonitoringService } from './retention-monitoring.service.js';
import { RetentionScoresQueryService } from './retention-scores-query.service.js';
import { RetentionTasksQueryService } from './retention-tasks-query.service.js';

export interface VisaoGeralDeRetencao {
  readonly pipeline: SaudeDoPipeline;
  readonly filaDeRisco: Readonly<Record<FaixaDeRisco, number>>;
  readonly filaDeTarefas: Readonly<Partial<Record<EstadoDeTarefa, number>>>;
}

/**
 * Agregado da tela `/retention/overview` (F75, SPEC-075 §3.2).
 *
 * NENHUM DADO NOVO -- so conta o que as tres leituras da F37/F38/F41 ja
 * calculam. `contagemPorBanda`/`contagemPorEstado` usam `groupBy` no banco,
 * nao a pagina de `fila()`: contar a pagina truncaria a fila em silencio no
 * tenant com mais itens que o limite de leitura (achado do code review desta
 * fatia).
 */
@Injectable()
export class RetentionOverviewService {
  constructor(
    private readonly monitoramento: RetentionMonitoringService,
    private readonly scoresQuery: RetentionScoresQueryService,
    private readonly tasksQuery: RetentionTasksQueryService,
  ) {}

  async visaoGeral(contexto: TenantContext, agora: Date): Promise<VisaoGeralDeRetencao> {
    const [painel, filaDeRisco, filaDeTarefas] = await Promise.all([
      this.monitoramento.painel(contexto, agora),
      this.scoresQuery.contagemPorBanda(contexto),
      this.tasksQuery.contagemPorEstado(contexto),
    ]);

    return { pipeline: painel.pipeline, filaDeRisco, filaDeTarefas };
  }
}
