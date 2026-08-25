import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';

import { KioskRoute } from '../kiosk-auth/kiosk-route.decorator.js';
import type { ContextoDoKiosk } from '../kiosk-auth/kiosk-auth.service.js';
import { KioskConfigService, type ConfiguracaoResolvida } from './kiosk-config.service.js';

const heartbeatSchema = z.object({
  agentVersion: z.string().min(1),
  /** Relogio local do totem em ms, para medir a deriva. */
  localTimeMs: z.number().int(),
});

/**
 * Endpoints do totem. Substitui o controller minimo da Task 3 (F49) --
 * aquele so provava o `KioskAuthGuard`; este entrega a superficie real.
 */
@Controller('api/v1/kiosk')
@KioskRoute()
export class KioskController {
  constructor(private readonly config: KioskConfigService) {}

  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(
    @Req() requisicao: Request,
    @Body() corpo: unknown,
  ): Promise<{ configVersion: number; serverTime: string }> {
    const contexto = this.contexto(requisicao);
    const dados = heartbeatSchema.parse(corpo);
    const agora = new Date();

    const { version } = await this.config.resolverParaDispositivo(contexto);

    await this.config.registrarHeartbeat(contexto, dados, agora);

    // `configVersion` nasce AQUI, na F49: a F50 declara este endpoint como
    // pre-existente e compara este numero com o do boot (ADR-042, Decisao 3).
    return { configVersion: version, serverTime: agora.toISOString() };
  }

  @Get('config')
  async obterConfig(@Req() requisicao: Request): Promise<ConfiguracaoResolvida> {
    return this.config.resolverParaDispositivo(this.contexto(requisicao));
  }

  private contexto(requisicao: Request): ContextoDoKiosk {
    const contexto = requisicao.kioskContext;

    if (!contexto) {
      throw new Error('Rota de kiosk sem contexto -- o guard nao rodou.');
    }

    return contexto;
  }
}
