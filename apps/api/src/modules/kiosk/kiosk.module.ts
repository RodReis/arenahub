import { Module } from '@nestjs/common';

import { PersistenceModule } from '../../persistence/persistence.module.js';
import { KioskAuthModule } from '../kiosk-auth/kiosk-auth.module.js';
import { KioskConfigService } from './kiosk-config.service.js';
import { KioskSessionService } from './kiosk-session.service.js';
import { KioskController } from './kiosk.controller.js';

/**
 * Endpoints do totem: heartbeat, configuracao resolvida (F49, Task 4) e
 * sessao efemera do aluno (F49, Task 5).
 */
@Module({
  imports: [PersistenceModule, KioskAuthModule],
  controllers: [KioskController],
  providers: [KioskConfigService, KioskSessionService],
})
export class KioskModule {}
