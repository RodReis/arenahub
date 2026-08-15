import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { CorrelationIdMiddleware } from './common/http/correlation-id.middleware.js';
import { ProblemDetailsFilter } from './common/http/problem-details.filter.js';
import { HealthController } from './health/health.controller.js';
import { VerificadorDeBanco } from './health/verificador-de-banco.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { PersistenceModule } from './persistence/persistence.module.js';

/**
 * Monolito modular: cada modulo de dominio entra aqui, e a conversa entre
 * eles e por caso de uso publico ou evento -- nunca por tabela privada de
 * outro modulo (`CLAUDE.md`, regra de arquitetura 9).
 */
@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [HealthController],
  providers: [
    VerificadorDeBanco,
    // Filtro global: nenhuma rota escapa do `problem+json`, nem as que
    // ninguem lembrou de decorar.
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumidor: MiddlewareConsumer): void {
    // Em todas as rotas: sem correlationId, o filtro de erro nao tem como
    // ligar a resposta ao log.
    consumidor.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
