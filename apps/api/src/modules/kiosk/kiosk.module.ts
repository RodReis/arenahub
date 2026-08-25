import { Module } from '@nestjs/common';

import { KioskAuthModule } from '../kiosk-auth/kiosk-auth.module.js';
import { KioskController } from './kiosk.controller.js';

/**
 * Endpoints do totem. Hoje so o heartbeat minimo (F49, Task 3); a Task 4
 * entrega o resto da superficie.
 */
@Module({
  imports: [KioskAuthModule],
  controllers: [KioskController],
})
export class KioskModule {}
