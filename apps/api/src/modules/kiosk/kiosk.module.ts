import { Module } from '@nestjs/common';

import { PersistenceModule } from '../../persistence/persistence.module.js';
import { AccessQueryModule } from '../access-query/access-query.module.js';
import { KioskAuthModule } from '../kiosk-auth/kiosk-auth.module.js';
import { KioskConfigService } from './kiosk-config.service.js';
import { KioskMediaLinkService } from './kiosk-media-link.service.js';
import { KioskSessionService } from './kiosk-session.service.js';
import { KioskController } from './kiosk.controller.js';

/**
 * Endpoints do totem: heartbeat, configuracao resolvida (F49, Task 4) e
 * sessao efemera do aluno (F49, Task 5) -- mais a tela publica da F51:
 * midia assinada no boot e indicadores da unidade no heartbeat.
 *
 * `AccessQueryModule` entra pelo CASO DE USO PUBLICO dele
 * (`contarEntradasDaUnidade`), nunca por leitura direta de `access_events`:
 * modulo nao le tabela privada de outro (regra de arquitetura no 9).
 */
@Module({
  imports: [PersistenceModule, KioskAuthModule, AccessQueryModule],
  controllers: [KioskController],
  providers: [KioskConfigService, KioskMediaLinkService, KioskSessionService],
})
export class KioskModule {}
