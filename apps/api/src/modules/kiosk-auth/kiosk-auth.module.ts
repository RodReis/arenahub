import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { PersistenceModule } from '../../persistence/persistence.module.js';
import { KioskAuthGuard } from './kiosk-auth.guard.js';
import { KioskAuthService } from './kiosk-auth.service.js';

/**
 * Autenticacao do totem por assinatura HMAC.
 *
 * O guard e GLOBAL, como o `EdgeAuthGuard`: ele so age em rota marcada com
 * `@KioskRoute()`, e registrar por controller deixaria a rota nova
 * desprotegida ate alguem lembrar.
 *
 * O corpo cru NAO e capturado aqui: quem faz isso e o parser global
 * (`aplicarParserComCorpoCru`, no `main.ts`), porque o body-parser do Nest
 * consome o stream antes de qualquer middleware de modulo rodar.
 */
@Module({
  imports: [PersistenceModule],
  providers: [KioskAuthService, { provide: APP_GUARD, useClass: KioskAuthGuard }],
  exports: [KioskAuthService],
})
export class KioskAuthModule {}
