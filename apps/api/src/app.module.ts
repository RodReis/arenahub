import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { CorrelationIdMiddleware } from './common/http/correlation-id.middleware.js';
import { ProblemDetailsFilter } from './common/http/problem-details.filter.js';
import { AuthGuard } from './common/security/auth.guard.js';
import { PermissionsGuard } from './common/security/permissions.guard.js';
import { AntivirusModule } from './common/antivirus/antivirus.module.js';
import { MediaFetcherModule } from './common/media-fetcher/media-fetcher.module.js';
import { StorageModule } from './common/storage/storage.module.js';
import { HealthController } from './health/health.controller.js';
import { VerificadorDeBanco } from './health/verificador-de-banco.js';
import { VerificadorDeRedis } from './health/verificador-de-redis.js';
import { AccessModule } from './modules/access/access.module.js';
import { AccessQueryModule } from './modules/access-query/access-query.module.js';
import { ExportsModule } from './modules/exports/exports.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { IamModule } from './modules/iam/iam.module.js';
import { BiometricsModule } from './modules/biometrics/biometrics.module.js';
import { DeviceSyncModule } from './modules/device-sync/device-sync.module.js';
import { DevicesModule } from './modules/devices/devices.module.js';
import { EdgeAuthModule } from './modules/edge-auth/edge-auth.module.js';
import { EngagementModule } from './modules/engagement/engagement.module.js';
import { RetentionModule } from './modules/retention/retention.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { KioskModule } from './modules/kiosk/kiosk.module.js';
import { KioskAdminModule } from './modules/kiosk-admin/kiosk-admin.module.js';
import { KioskAuthModule } from './modules/kiosk-auth/kiosk-auth.module.js';
import { MembershipModule } from './modules/membership/membership.module.js';
import { OperationsModule } from './modules/operations/operations.module.js';
import { PrivacyModule } from './modules/privacy/privacy.module.js';
import { StudentsModule } from './modules/students/students.module.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';
import { PersistenceModule } from './persistence/persistence.module.js';

/**
 * Monolito modular: cada modulo de dominio entra aqui, e a conversa entre
 * eles e por caso de uso publico ou evento -- nunca por tabela privada de
 * outro modulo (`CLAUDE.md`, regra de arquitetura 9).
 */
@Module({
  imports: [
    // Agendador do avaliador de alertas (F11, INV-146). `forRoot` uma vez
    // so, na raiz -- registrar por modulo criaria varios agendadores para o
    // mesmo `@Interval`.
    ScheduleModule.forRoot(),
    PersistenceModule,
    AntivirusModule,
    MediaFetcherModule,
    StorageModule,
    AuthModule,
    IamModule,
    TenancyModule,
    StudentsModule,
    BillingModule,
    MembershipModule,
    PrivacyModule,
    DevicesModule,
    BiometricsModule,
    EngagementModule,
    RetentionModule,
    EdgeAuthModule,
    KioskAuthModule,
    KioskModule,
    KioskAdminModule,
    DeviceSyncModule,
    AccessModule,
    AccessQueryModule,
    ExportsModule,
    OperationsModule,
    HealthModule,
  ],
  controllers: [HealthController],
  providers: [
    VerificadorDeBanco,
    VerificadorDeRedis,
    // Filtro global: nenhuma rota escapa do `problem+json`, nem as que
    // ninguem lembrou de decorar.
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    // A ORDEM IMPORTA. `AuthGuard` primeiro porque e ele que poe o
    // `TenantContext` na requisicao; `PermissionsGuard` depois, porque le
    // dali. Invertidos, a autorizacao rodaria sem saber quem e o ator.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumidor: MiddlewareConsumer): void {
    // Em todas as rotas: sem correlationId, o filtro de erro nao tem como
    // ligar a resposta ao log.
    consumidor.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
