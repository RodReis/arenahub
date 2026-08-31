import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { PersistenceModule } from '../../persistence/persistence.module.js';
import { RetentionScoresController } from './retention-scores.controller.js';
import { PORTA_DE_SCORES, RetentionScoresRepository } from './retention-scores.repository.js';
import { RetentionScoresService } from './retention-scores.service.js';
import {
  PORTA_DE_EXPERIMENTOS,
  RetentionExperimentsRepository,
} from './retention-experiments.repository.js';
import { RetentionMonitoringController } from './retention-monitoring.controller.js';
import {
  PORTA_DE_MONITORAMENTO,
  RetentionMonitoringRepository,
} from './retention-monitoring.repository.js';
import { RetentionMonitoringService } from './retention-monitoring.service.js';
import { RetentionExperimentsService } from './retention-experiments.service.js';
import { RetentionTasksController } from './retention-tasks.controller.js';
import { RetentionTasksQueryRepository } from './retention-tasks-query.repository.js';
import {
  PORTA_DE_CONSULTA_DE_TAREFAS,
  RetentionTasksQueryService,
} from './retention-tasks-query.service.js';
import { PORTA_DE_TAREFAS, RetentionTasksRepository } from './retention-tasks.repository.js';
import { RetentionTasksService } from './retention-tasks.service.js';
import { RetentionScoresQueryRepository } from './retention-scores-query.repository.js';
import {
  PORTA_DE_CONSULTA_DE_SCORES,
  RetentionScoresQueryService,
} from './retention-scores-query.service.js';
import {
  PORTA_DE_RETENCAO,
  RetentionSnapshotsRepository,
} from './retention-snapshots.repository.js';
import { RetentionSnapshotsService } from './retention-snapshots.service.js';

/**
 * Contrato de dados (F36, Slice 6.1) e regras explicaveis (F37, Slice 6.2).
 *
 * Declara `TenantContextService` explicitamente: na F30 a ausencia dessa
 * declaracao derrubou as 46 suites de integracao no boot, e o sintoma nao
 * apontava para o modulo. Custa uma linha e nao se repete.
 *
 * A F38 acrescenta a fila de tarefas: a seta do MVP 6 vai de "risco explicavel"
 * a "tarefa operacional", e sem ela o score da F37 seria relatorio, nao acao.
 *
 * A F39 mede se a seta funciona. O experimento e uma camada OPCIONAL sobre o
 * CRM -- sem experimento ativo a fila roda igual --, e o que ele acrescenta e
 * um braco de controle que nunca recebe tarefa. Sem esse braco nao ha como
 * separar "a ligacao reteve o aluno" de "o aluno ia ficar de qualquer jeito".
 *
 * A F41 fecha o MVP com o que a Slice 6.6 pede E existe sem modelo (a F40 nao
 * foi executada, ADR-050): kill switch do scoring, drift das features e saude
 * do pipeline. Champion/challenger e calibracao ficam fora -- score de regra
 * nao calibra, e nao ha duas versoes competindo.
 *
 * A F37 abriu a PRIMEIRA rota HTTP de retencao. A F36 deixou o modulo interno de
 * proposito -- expor score antes da baseline seria mostrar um numero que ainda
 * nao significava nada. Agora significa: cada ponto tem regra, valor observado
 * e limite, e a tela pode ser contestada.
 */
@Module({
  imports: [PersistenceModule],
  controllers: [
    RetentionScoresController,
    RetentionTasksController,
    RetentionMonitoringController,
  ],
  providers: [
    TenantContextService,
    RetentionSnapshotsService,
    RetentionScoresService,
    RetentionScoresQueryService,
    { provide: PORTA_DE_RETENCAO, useClass: RetentionSnapshotsRepository },
    { provide: PORTA_DE_SCORES, useClass: RetentionScoresRepository },
    { provide: PORTA_DE_CONSULTA_DE_SCORES, useClass: RetentionScoresQueryRepository },
    RetentionTasksService,
    RetentionTasksQueryService,
    { provide: PORTA_DE_TAREFAS, useClass: RetentionTasksRepository },
    { provide: PORTA_DE_CONSULTA_DE_TAREFAS, useClass: RetentionTasksQueryRepository },
    RetentionExperimentsService,
    { provide: PORTA_DE_EXPERIMENTOS, useClass: RetentionExperimentsRepository },
    RetentionMonitoringService,
    { provide: PORTA_DE_MONITORAMENTO, useClass: RetentionMonitoringRepository },
  ],
  exports: [
    RetentionSnapshotsService,
    RetentionScoresService,
    RetentionTasksService,
    RetentionExperimentsService,
    RetentionMonitoringService,
  ],
})
export class RetentionModule {}
