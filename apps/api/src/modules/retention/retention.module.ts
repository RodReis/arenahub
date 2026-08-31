import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { PersistenceModule } from '../../persistence/persistence.module.js';
import {
  PORTA_DE_RETENCAO,
  RetentionSnapshotsRepository,
} from './retention-snapshots.repository.js';
import { RetentionSnapshotsService } from './retention-snapshots.service.js';

/**
 * Contrato de dados e baseline analitica (F36, SPEC-036, Slice 6.1).
 *
 * Declara `TenantContextService` explicitamente: na F30 a ausencia dessa
 * declaracao derrubou as 46 suites de integracao no boot, e o sintoma nao
 * apontava para o modulo. Custa uma linha e nao se repete.
 *
 * Sem controller ainda -- a Slice 6.1 entrega o pipeline de dados; a leitura
 * agregada (`GET /api/v1/retention/overview`) e o score sao das fatias
 * seguintes. Nao ha rota individual de score por aluno de proposito: o PRD §7
 * so a preve depois da baseline, e expo-la antes seria mostrar um numero que
 * ainda nao significa nada.
 */
@Module({
  imports: [PersistenceModule],
  providers: [
    TenantContextService,
    RetentionSnapshotsService,
    { provide: PORTA_DE_RETENCAO, useClass: RetentionSnapshotsRepository },
  ],
  exports: [RetentionSnapshotsService],
})
export class RetentionModule {}
