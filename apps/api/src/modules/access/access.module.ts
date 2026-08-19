import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { EdgeAuthModule } from '../edge-auth/edge-auth.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { AccessEventRepository } from './access-event.repository.js';
import { AccessProjectionRepository } from './access-projection.repository.js';
import { DecideOnlineAccessUseCase } from './decide-online-access.use-case.js';
import { EdgeAccessController } from './edge-access.controller.js';
import { IdentityResolver } from './identity-resolver.js';
import { ManualOverrideController } from './manual-override.controller.js';
import { ManualOverrideUseCase } from './manual-override.use-case.js';

/**
 * Decisao de acesso e passagem -- F9.
 *
 * Nao importa `MembershipModule` nem nada financeiro, e isso e proposital
 * (regra de arquitetura no 1). A projecao le `Entitlement` direto porque
 * entitlement e o contrato publico do acesso; assinatura e invoice ficam do
 * outro lado da fronteira.
 */
@Module({
  /**
   * `BillingModule` entra pela liberacao financeira da F15: antes de negar por
   * divida, o acesso pergunta se ha liberacao viva. Consome o CASO DE USO
   * publico, nunca a tabela (regra de arquitetura no 9).
   */
  imports: [EdgeAuthModule, BillingModule],
  controllers: [EdgeAccessController, ManualOverrideController],
  providers: [
    IdentityResolver,
    AccessProjectionRepository,
    AccessEventRepository,
    DecideOnlineAccessUseCase,
    ManualOverrideUseCase,
    TenantContextService,
  ],
  exports: [IdentityResolver, AccessProjectionRepository, AccessEventRepository],
})
export class AccessModule {}
