import { Module } from '@nestjs/common';

import { PersistenceModule } from '../../persistence/persistence.module.js';
import { EngagementRepository, PORTA_DE_ENGAJAMENTO } from './engagement.repository.js';
import { EngagementService } from './engagement.service.js';

/**
 * Preferencia de engajamento e identidade publica (F30, ADR-046).
 *
 * Exporta `EngagementService` -- o KioskModule vai consumi-lo como caso de
 * uso publico (regra de arquitetura no 9), nunca lendo `PublicProfile`
 * direto.
 */
@Module({
  imports: [PersistenceModule],
  providers: [
    EngagementService,
    { provide: PORTA_DE_ENGAJAMENTO, useClass: EngagementRepository },
  ],
  exports: [EngagementService],
})
export class EngagementModule {}
