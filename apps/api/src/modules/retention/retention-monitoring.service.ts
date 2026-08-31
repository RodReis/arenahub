import { Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import {
  compararDistribuicoes,
  type AchadoDeDrift,
} from './domain/drift-de-features.js';
import {
  avaliarSaudeDoPipeline,
  type SaudeDoPipeline,
} from './domain/saude-do-pipeline.js';
import {
  PORTA_DE_MONITORAMENTO,
  type PortaDeMonitoramento,
} from './retention-monitoring.repository.js';

export interface PainelDeMonitoramento {
  readonly pipeline: SaudeDoPipeline;
  readonly drift: readonly AchadoDeDrift[];
  /** Há algo que exige ação humana agora. */
  readonly precisaDeAtencao: boolean;
}

/**
 * Produção controlada do scoring de retenção (F41, Slice 6.6).
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA FATIA MONITORA, E POR QUE NÃO É O QUE A SLICE PEDIA
 * ---------------------------------------------------------------------------
 *
 * A Slice 6.6 foi escrita para um modelo: champion/challenger, drift de score,
 * calibração por faixa. A F40 não foi executada (ADR-050) — o gate de dado não
 * fecha —, então esses três não têm objeto: score de regra não calibra, e não
 * há duas versões competindo.
 *
 * Ficou o que tem valor próprio e independe de modelo:
 *
 *   - **kill switch** (`M6-FR-017`) — a chave que para o scoring sem deploy;
 *   - **drift de feature** (`M6-FR-018`) — as 13 features da F36 são a entrada
 *     de tudo, hoje da baseline e amanhã do modelo;
 *   - **saúde do pipeline** (`M6-BR-009`) — o job que parou não tem sintoma:
 *     a fila aparece vazia, e fila vazia lê-se como boa notícia.
 *
 * ---------------------------------------------------------------------------
 * DESLIGADO NÃO PRECISA DE ATENÇÃO
 * ---------------------------------------------------------------------------
 *
 * Com o kill switch acionado, `precisaDeAtencao` é sempre `false` — mesmo com
 * drift crítico no histórico. A razão é operacional, não técnica: alarme que
 * dispara para uma situação que alguém criou de propósito treina a operação a
 * ignorar o alarme, e alarme ignorado é pior que alarme nenhum porque dá
 * sensação de cobertura.
 */
@Injectable()
export class RetentionMonitoringService {
  constructor(
    @Inject(PORTA_DE_MONITORAMENTO) private readonly porta: PortaDeMonitoramento,
  ) {}

  /**
   * O painel de saúde: pipeline, drift e o veredito de atenção.
   *
   * `agora` entra por parâmetro — função que lê relógio envelhece o teste, e a
   * F38 já pagou por misturar dois relógios na mesma conta.
   */
  async painel(contexto: TenantContext, agora: Date): Promise<PainelDeMonitoramento> {
    const estado = await this.porta.estadoDoScoring(contexto);

    const pipeline = avaliarSaudeDoPipeline(
      { ultimoSnapshotEm: estado.ultimoSnapshotEm, scoringLigado: estado.ligado },
      agora,
    );

    const [anterior, atual] = await Promise.all([
      this.porta.resumoDoPeriodo(contexto, 'ANTERIOR'),
      this.porta.resumoDoPeriodo(contexto, 'ATUAL'),
    ]);

    const drift = compararDistribuicoes(anterior, atual);

    return {
      pipeline,
      drift,
      // Só CRÍTICO acorda alguém. `ATENCAO` aparece na tela e não vira alarme.
      precisaDeAtencao:
        estado.ligado &&
        (pipeline.estado === 'ATRASADO' ||
          pipeline.estado === 'NUNCA_RODOU' ||
          drift.some((achado) => achado.severidade === 'CRITICO')),
    };
  }

  /**
   * O kill switch (`M6-FR-017`, `M6-NFR-006`).
   *
   * Um `UPDATE` numa coluna: é o caminho mais curto entre a decisão e o efeito,
   * e "em até cinco minutos" é o requisito. Desliga **só o cálculo novo** —
   * scores gravados seguem legíveis com marca de idade e tarefas abertas seguem
   * tratáveis, como `M6-NFR-009` exige.
   */
  async definirScoring(contexto: TenantContext, ligado: boolean): Promise<void> {
    await this.porta.definirScoring(contexto, ligado);
  }

  /** Consultado pelo pipeline antes de pontuar. */
  async scoringLigado(contexto: TenantContext): Promise<boolean> {
    return (await this.porta.estadoDoScoring(contexto)).ligado;
  }
}
