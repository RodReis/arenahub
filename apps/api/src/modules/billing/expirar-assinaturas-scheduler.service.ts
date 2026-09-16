import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { BillingRepository } from './billing.repository.js';
import { ExpirarAssinaturasVencidasUseCase } from './expirar-assinaturas-vencidas.use-case.js';

/**
 * Expiracao diaria de assinatura vencida -- issue #272, lacuna achada apos o
 * fix original.
 *
 * ESPELHA `AlertSchedulerService` (F11) e `EngagementRankingSchedulerService`
 * (F35) de proposito -- mesmo precedente, mesmas garantias: `@Cron` do
 * `@nestjs/schedule`, ja ligado em `app.module.ts`; trava de reentrada NO
 * PROCESSO; `agora` INJETADO no ciclo -- o teste nao espera um dia; falha de
 * um tenant NAO derruba os outros.
 */
@Injectable()
export class ExpirarAssinaturasSchedulerService {
  private readonly log = new Logger(ExpirarAssinaturasSchedulerService.name);

  /** Trava de reentrada -- ver `AlertSchedulerService.avaliando`. */
  private expirando = false;

  constructor(
    private readonly repositorio: BillingRepository,
    private readonly expirarAssinaturas: ExpirarAssinaturasVencidasUseCase,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'expiracao-de-assinaturas-vencidas' })
  async expirar(): Promise<void> {
    if (this.expirando) {
      this.log.warn('expiracao anterior ainda em curso; pulando este ciclo');

      return;
    }

    this.expirando = true;

    try {
      await this.executarCiclo(new Date());
    } finally {
      this.expirando = false;
    }
  }

  /**
   * Um ciclo completo. `agora` injetado -- o teste nao espera um dia.
   *
   * Falha em um tenant NAO impede os outros -- um tenant com dado
   * inconsistente nao pode travar a expiracao de todo o resto.
   */
  async executarCiclo(agora: Date): Promise<{ tenants: number; expiradas: number; falhas: number }> {
    const tenants = await this.repositorio.listarTenantsAtivos();

    let expiradas = 0;
    let falhas = 0;

    for (const tenantId of tenants) {
      try {
        const resultado = await this.expirarAssinaturas.executar(tenantId, agora);
        expiradas += resultado.expiradas;
      } catch (erro: unknown) {
        falhas += 1;

        this.log.error(
          `falha ao expirar assinaturas do tenant ${tenantId}: ${
            erro instanceof Error ? erro.message : 'erro desconhecido'
          }`,
        );
      }
    }

    return { tenants: tenants.length, expiradas, falhas };
  }
}
