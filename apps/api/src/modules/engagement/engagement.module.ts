import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
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
    // `TenantContextService` e injetado pelo `EngagementController` e precisa
    // ser declarado AQUI, como `PrivacyModule` e `KioskAdminModule` fazem.
    // Sem esta linha o Nest nao resolve o controller e derruba o boot da
    // aplicacao INTEIRA -- inclusive suite de modulo sem relacao nenhuma com
    // engajamento. O teste unitario do controller nao pega: ele declara o
    // provider na mao no `Test.createTestingModule`, entao passa verde
    // enquanto o `AppModule` real quebra.
    TenantContextService,
    { provide: PORTA_DE_ENGAJAMENTO, useClass: EngagementRepository },
  ],
  exports: [EngagementService],
})
export class EngagementModule {}
