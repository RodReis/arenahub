import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { PersistenceModule } from '../../persistence/persistence.module.js';
import { EngagementController } from './engagement.controller.js';
import { EngagementRepository, PORTA_DE_ENGAJAMENTO } from './engagement.repository.js';
import { EngagementService } from './engagement.service.js';
import { EngagementXpRepository, PORTA_DE_XP } from './engagement-xp.repository.js';
import { EngagementXpService } from './engagement-xp.service.js';
import { EngagementRankingRepository, PORTA_DE_RANKING } from './engagement-ranking.repository.js';
import { EngagementRankingService } from './engagement-ranking.service.js';

/**
 * Preferencia de engajamento e identidade publica (F30, ADR-046) + XP e
 * conquistas (F31) + placar mensal (F31, Task 8).
 *
 * Exporta `EngagementService`, `EngagementXpService` e
 * `EngagementRankingService` -- o KioskModule vai consumir os tres como caso
 * de uso publico (regra de arquitetura no 9), nunca lendo
 * `PublicProfile`/`XpLedgerEntry`/`RankingEntry` direto. `EngagementController`
 * (Task 7) e a fila de moderacao do painel.
 */
@Module({
  imports: [PersistenceModule],
  controllers: [EngagementController],
  providers: [
    EngagementService,
    EngagementXpService,
    EngagementRankingService,
    // `TenantContextService` e injetado pelo `EngagementController` e precisa
    // ser declarado AQUI, como `PrivacyModule` e `KioskAdminModule` fazem.
    // Sem esta linha o Nest nao resolve o controller e derruba o boot da
    // aplicacao INTEIRA -- inclusive suite de modulo sem relacao nenhuma com
    // engajamento. O teste unitario do controller nao pega: ele declara o
    // provider na mao no `Test.createTestingModule`, entao passa verde
    // enquanto o `AppModule` real quebra.
    TenantContextService,
    { provide: PORTA_DE_ENGAJAMENTO, useClass: EngagementRepository },
    { provide: PORTA_DE_XP, useClass: EngagementXpRepository },
    { provide: PORTA_DE_RANKING, useClass: EngagementRankingRepository },
  ],
  exports: [EngagementService, EngagementXpService, EngagementRankingService],
})
export class EngagementModule {}
