import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { comContexto } from '@arenahub/database';

import { BillingRepository } from './billing.repository.js';
import { GerarFaturasDoMesUseCase, type ResultadoDaGeracao } from './gerar-faturas-do-mes.use-case.js';

/**
 * Fatura do mes todo dia 01 (F88, decisao do PI em 07/10/2026). Este job so
 * decide QUANDO roda `GerarFaturasDoMesUseCase`, que e reexecutavel (INV-066):
 * se o processo estiver fora do ar as 00:05 do dia 01, subir depois e chamar a
 * rota `billing/monthly-invoices/run` repoe o que faltou sem duplicar nada.
 *
 * SEM PORTAO DE ENV: gerar fatura nao muda acesso de ninguem -- o bloqueio por
 * inadimplencia (`AplicarInadimplenciaSchedulerService`) e que nasce desligado.
 *
 * ESPELHA `AplicarInadimplenciaSchedulerService`: trava de reentrada no
 * processo, `agora` injetado, falha de um tenant nao derruba os outros.
 */
@Injectable()
export class GerarFaturasDoMesSchedulerService {
  private readonly log = new Logger(GerarFaturasDoMesSchedulerService.name);

  private executando = false;

  constructor(
    private readonly repositorio: BillingRepository,
    private readonly gerar: GerarFaturasDoMesUseCase,
  ) {}

  @Cron('5 0 1 * *', { name: 'gerar-faturas-do-mes', timeZone: 'America/Sao_Paulo' })
  async executarComTrava(): Promise<void> {
    if (this.executando) {
      this.log.warn('ciclo anterior ainda em curso; pulando este ciclo');

      return;
    }

    this.executando = true;

    try {
      const resultado = await this.executarCiclo(new Date());
      this.log.log(`faturas do mes: ${JSON.stringify(resultado)}`);
    } finally {
      this.executando = false;
    }
  }

  /**
   * Um ciclo completo. Abre o proprio contexto de tenant -- o job nao passa
   * pelo interceptor HTTP, e `students` tem RLS.
   */
  async executarCiclo(agora: Date): Promise<ResultadoDaGeracao & { tenants: number }> {
    const tenants = await this.repositorio.listarTenantsAtivos();

    let elegiveis = 0;
    let criadas = 0;
    let jaExistiam = 0;
    let falhas = 0;

    for (const tenantId of tenants) {
      try {
        const resultado = await comContexto({ kind: 'tenant', tenantId }, () =>
          this.gerar.executar(tenantId, agora),
        );
        elegiveis += resultado.elegiveis;
        criadas += resultado.criadas;
        jaExistiam += resultado.jaExistiam;
        falhas += resultado.falhas;
      } catch (erro: unknown) {
        falhas += 1;
        this.log.error(
          `falha ao gerar faturas do tenant ${tenantId}: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
        );
      }
    }

    return { tenants: tenants.length, elegiveis, criadas, jaExistiam, falhas };
  }
}
