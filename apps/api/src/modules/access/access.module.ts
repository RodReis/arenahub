import { Module } from '@nestjs/common';

import { EdgeAuthModule } from '../edge-auth/edge-auth.module.js';
import { AccessEventRepository } from './access-event.repository.js';
import { AccessProjectionRepository } from './access-projection.repository.js';
import { IdentityResolver } from './identity-resolver.js';

/**
 * Decisao de acesso e passagem -- F9.
 *
 * Nao importa `MembershipModule` nem nada financeiro, e isso e proposital
 * (regra de arquitetura no 1). A projecao le `Entitlement` direto porque
 * entitlement e o contrato publico do acesso; assinatura e invoice ficam do
 * outro lado da fronteira.
 */
@Module({
  imports: [EdgeAuthModule],
  providers: [IdentityResolver, AccessProjectionRepository, AccessEventRepository],
  exports: [IdentityResolver, AccessProjectionRepository, AccessEventRepository],
})
export class AccessModule {}
