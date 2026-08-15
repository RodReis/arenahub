import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller.js';
import { VerificadorDeBanco } from './health/verificador-de-banco.js';

/**
 * Monolito modular: cada modulo de dominio entra aqui, e a conversa entre eles
 * e por caso de uso publico ou evento -- nunca por tabela privada de outro
 * modulo (`CLAUDE.md`, regra de arquitetura 9).
 */
@Module({
  controllers: [HealthController],
  providers: [VerificadorDeBanco],
})
export class AppModule {}
