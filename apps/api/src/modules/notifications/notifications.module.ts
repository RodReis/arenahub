import { Module } from '@nestjs/common';

import { EngagementModule } from '../engagement/engagement.module.js';
import { PersistenceModule } from '../../persistence/persistence.module.js';
import { EngagementXpConsumer } from './engagement-xp.consumer.js';
import { HealthGoalDetectionSchedulerService } from './health-goal-detection-scheduler.service.js';
import {
  HealthGoalDetectionRepository,
} from './health-goal-detection.repository.prisma.js';
import { PORTA_DE_DETECCAO_DE_META } from './health-goal-detection.repository.js';
import { NotificationDeadlineSchedulerService } from './notification-deadline-scheduler.service.js';
import { NotificationDeadlineRepository } from './notification-deadline.repository.prisma.js';
import { PORTA_DE_PRAZO } from './notification-deadline.repository.js';
import { NotificationsInboxConsumer } from './notifications-inbox.consumer.js';
import { NotificationsInboxRepository } from './notifications-inbox.repository.prisma.js';
import { PORTA_DE_AVISOS } from './notifications-inbox.repository.js';
import {
  CONSUMIDORES_DE_EVENTO,
  OutboxDispatcherService,
} from './outbox-dispatcher.service.js';
import { OutboxDispatcherRepository } from './outbox-dispatcher.repository.prisma.js';
import { PORTA_DE_DISPATCH } from './outbox-dispatcher.repository.js';

/**
 * Despachante de outbox e os oito eventos de notificacao da §70 -- F73,
 * ADR-058, issue #343.
 *
 * SO PROVIDERS -- nao ha controller nem rota. Os quatro `@Cron` (ja
 * ligados por `ScheduleModule.forRoot()` no `app.module.ts`) sao quem
 * dispara tudo: `OutboxDispatcherService` a cada minuto, os dois
 * schedulers de deteccao/prazo uma vez por dia, mesmo padrao de
 * `EngagementRankingSchedulerService`/`PlatformInvoiceSchedulerService`.
 *
 * `EngagementModule` e importado (nao so `PORTA_DE_XP` isolado) porque o
 * token e exportado de la -- ver o comentario em `engagement.module.ts`.
 */
@Module({
  imports: [PersistenceModule, EngagementModule],
  providers: [
    { provide: PORTA_DE_DISPATCH, useClass: OutboxDispatcherRepository },
    { provide: PORTA_DE_AVISOS, useClass: NotificationsInboxRepository },
    { provide: PORTA_DE_PRAZO, useClass: NotificationDeadlineRepository },
    { provide: PORTA_DE_DETECCAO_DE_META, useClass: HealthGoalDetectionRepository },
    NotificationsInboxConsumer,
    EngagementXpConsumer,
    {
      provide: CONSUMIDORES_DE_EVENTO,
      useFactory: (inbox: NotificationsInboxConsumer, xp: EngagementXpConsumer) => [inbox, xp],
      inject: [NotificationsInboxConsumer, EngagementXpConsumer],
    },
    OutboxDispatcherService,
    NotificationDeadlineSchedulerService,
    HealthGoalDetectionSchedulerService,
  ],
})
export class NotificationsModule {}
