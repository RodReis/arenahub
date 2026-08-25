import { Controller, HttpCode, Post } from '@nestjs/common';

import { KioskRoute } from '../kiosk-auth/kiosk-route.decorator.js';

/**
 * Controller minimo do totem, so para provar o `KioskAuthGuard` (F49,
 * Task 3). A Task 4 substitui o corpo do heartbeat pelo real.
 */
@Controller('api/v1/kiosk')
export class KioskController {
  @Post('heartbeat')
  @KioskRoute()
  @HttpCode(200)
  heartbeat(): { ok: true } {
    return { ok: true };
  }
}
