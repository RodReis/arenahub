import { Module } from '@nestjs/common';

import { PersistenceModule } from '../../persistence/persistence.module.js';
import { EngagementController } from './engagement.controller.js';
import { EngagementRepository, PORTA_DE_ENGAJAMENTO } from './engagement.repository.js';
import { EngagementService } from './engagement.service.js';

/**
 * Preferencia de engajamento e identidade publica (F30, ADR-046).
 *
 * Exporta `EngagementService` -- o KioskModule vai consumi-lo como caso de
 * uso publico (regra de arquitetura no 9), nunca lendo `PublicProfile`
 * direto. `EngagementController` (Task 7) e a fila de moderacao do painel.
 */
@Module({
  imports: [PersistenceModule],
  controllers: [EngagementController],
  providers: [
    EngagementService,
    { provide: PORTA_DE_ENGAJAMENTO, useClass: EngagementRepository },
  ],
  exports: [EngagementService],
})
export class EngagementModule {}
