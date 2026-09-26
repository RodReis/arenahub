import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { EdgeAuthGuard } from './edge-auth.guard.js';
import { EdgeAuthService } from './edge-auth.service.js';
import { EdgeController } from './edge.controller.js';
import { EdgeNodeRepository } from './edge-node.repository.js';
import { EdgeNodesController } from './edge-nodes.controller.js';
import { PairingCodesController } from './pairing-codes.controller.js';
import { PairingController } from './pairing.controller.js';
import { PairingService } from './pairing.service.js';

/**
 * Autenticacao do Edge por assinatura HMAC.
 *
 * O guard e GLOBAL, como os outros dois: ele so age em rota marcada com
 * `@EdgeRoute()`, e registrar por controller deixaria a rota nova
 * desprotegida ate alguem lembrar.
 *
 * O corpo cru NAO e capturado aqui: quem faz isso e o parser global
 * (`aplicarParserComCorpoCru`, no `main.ts`), porque o body-parser do Nest
 * consome o stream antes de qualquer middleware de modulo rodar.
 */
@Module({
  controllers: [EdgeController, PairingController, PairingCodesController, EdgeNodesController],
  providers: [
    EdgeAuthService,
    PairingService,
    EdgeNodeRepository,
    TenantContextService,
    { provide: APP_GUARD, useClass: EdgeAuthGuard },
  ],
  exports: [EdgeAuthService],
})
export class EdgeAuthModule {}
