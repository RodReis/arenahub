import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { PersistenceModule } from '../../persistence/persistence.module.js';
import { EngagementController } from './engagement.controller.js';
import { EngagementContestacoesController } from './engagement-contestacoes.controller.js';
import { EngagementConfiguracaoController } from './engagement-configuracao.controller.js';
import { EngagementXpController } from './engagement-xp.controller.js';
import { EngagementRepository, PORTA_DE_ENGAJAMENTO } from './engagement.repository.js';
import { EngagementService } from './engagement.service.js';
import { EngagementXpRepository, PORTA_DE_XP } from './engagement-xp.repository.js';
import { EngagementXpService } from './engagement-xp.service.js';
import { EngagementRankingRepository, PORTA_DE_RANKING } from './engagement-ranking.repository.js';
import { EngagementRankingService } from './engagement-ranking.service.js';
import { EngagementRankingSchedulerService } from './engagement-ranking-scheduler.service.js';
import { EngagementChallengesController } from './engagement-challenges.controller.js';
import {
  EngagementChallengesRepository,
  PORTA_DE_DESAFIOS,
} from './engagement-challenges.repository.js';
import { EngagementChallengesService } from './engagement-challenges.service.js';

/**
 * Preferencia de engajamento e identidade publica (F30, ADR-046) + XP e
 * conquistas (F31) + placar mensal (F31, Task 8) + fechamento mensal
 * automatico do placar (F31, Task 13, Emenda de 27/08/2026).
 *
 * Exporta `EngagementService`, `EngagementXpService` e
 * `EngagementRankingService` -- o KioskModule vai consumir os tres como caso
 * de uso publico (regra de arquitetura no 9), nunca lendo
 * `PublicProfile`/`XpLedgerEntry`/`RankingEntry` direto. `EngagementController`
 * (Task 7) e a fila de moderacao do painel.
 *
 * `EngagementRankingSchedulerService` e SO provider -- nao ha rota nem
 * export: `@Cron` (ja ligado por `ScheduleModule.forRoot()` no
 * `app.module.ts`) e quem dispara, ninguem de fora chama isto direto.
 */
@Module({
  imports: [PersistenceModule],
  controllers: [
    EngagementController,
    EngagementContestacoesController,
    EngagementConfiguracaoController,
    EngagementXpController,
    EngagementChallengesController,
  ],
  providers: [
    EngagementService,
    EngagementXpService,
    EngagementRankingService,
    EngagementRankingSchedulerService,
    EngagementChallengesService,
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
    { provide: PORTA_DE_DESAFIOS, useClass: EngagementChallengesRepository },
  ],
  exports: [
    EngagementService,
    EngagementXpService,
    EngagementRankingService,
    // O KioskModule consome os desafios como caso de uso publico (regra de
    // arquitetura 9) -- nunca lendo `Challenge`/`ChallengeParticipant` direto.
    EngagementChallengesService,
  ],
})
export class EngagementModule {}
