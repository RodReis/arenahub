import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { PersistenceModule } from '../../persistence/persistence.module.js';
import { RetentionScoresController } from './retention-scores.controller.js';
import { PORTA_DE_SCORES, RetentionScoresRepository } from './retention-scores.repository.js';
import { RetentionScoresService } from './retention-scores.service.js';
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
 * A F37 abre a PRIMEIRA rota HTTP de retencao. A F36 deixou o modulo interno de
 * proposito -- expor score antes da baseline seria mostrar um numero que ainda
 * nao significava nada. Agora significa: cada ponto tem regra, valor observado
 * e limite, e a tela pode ser contestada.
 */
@Module({
  imports: [PersistenceModule],
  controllers: [RetentionScoresController],
  providers: [
    TenantContextService,
    RetentionSnapshotsService,
    RetentionScoresService,
    RetentionScoresQueryService,
    { provide: PORTA_DE_RETENCAO, useClass: RetentionSnapshotsRepository },
    { provide: PORTA_DE_SCORES, useClass: RetentionScoresRepository },
    { provide: PORTA_DE_CONSULTA_DE_SCORES, useClass: RetentionScoresQueryRepository },
  ],
  exports: [RetentionSnapshotsService, RetentionScoresService],
})
export class RetentionModule {}
