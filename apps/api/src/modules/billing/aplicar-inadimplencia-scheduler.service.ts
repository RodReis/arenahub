import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { comContexto } from '@arenahub/database';

import { AplicarInadimplenciaUseCase } from './aplicar-inadimplencia.use-case.js';
import { BillingRepository } from './billing.repository.js';

/**
 * Bloqueio automatico por inadimplencia (F88, decisao do PI em 07/10/2026):
 * 5 dias depois do vencimento a catraca nega. Este job so decide QUANDO roda
 * `AplicarInadimplenciaUseCase`, que ja era reexecutavel (`M2-FR-013`).
 *
 * DESLIGADO ATE O PI LIGAR: so roda com `BILLING_DELINQUENCY_JOB_ENABLED=true`.
 * A primeira execucao bloqueia todo STUDENT com fatura vencida ha mais de 5
 * dias -- o saneamento de producao (script `padronizar-vencimentos`) tem de
 * rodar antes, e o PI conferir a lista.
 *
 * ESPELHA `ExpirarAssinaturasSchedulerService`: trava de reentrada no
 * processo, `agora` injetado, falha de um tenant nao derruba os outros.
 */
@Injectable()
export class AplicarInadimplenciaSchedulerService {
  private readonly log = new Logger(AplicarInadimplenciaSchedulerService.name);

  private executando = false;

  constructor(
    private readonly repositorio: BillingRepository,
    private readonly aplicarInadimplencia: AplicarInadimplenciaUseCase,
  ) {}

  @Cron('10 0 * * *', { name: 'bloqueio-por-inadimplencia', timeZone: 'America/Sao_Paulo' })
  async executarComTrava(): Promise<void> {
    if (process.env['BILLING_DELINQUENCY_JOB_ENABLED'] !== 'true') return;

    if (this.executando) {
      this.log.warn('ciclo anterior ainda em curso; pulando este ciclo');

      return;
    }

    this.executando = true;

    try {
      const resultado = await this.executarCiclo(new Date());
      this.log.log(`inadimplencia: ${JSON.stringify(resultado)}`);
    } finally {
      this.executando = false;
    }
  }

  /**
   * Um ciclo completo. NAO le a env: so o `@Cron` acima decide se roda, para o
   * teste chamar o ciclo direto. Abre o proprio contexto de tenant -- o job
   * nao passa pelo interceptor HTTP, e `students` tem RLS.
   */
  async executarCiclo(agora: Date): Promise<{ tenants: number; direitosSuspensos: number; falhas: number }> {
    const tenants = await this.repositorio.listarTenantsAtivos();

    let direitosSuspensos = 0;
    let falhas = 0;

    for (const tenantId of tenants) {
      try {
        const resultado = await comContexto({ kind: 'tenant', tenantId }, () =>
          this.aplicarInadimplencia.executar(tenantId, agora),
        );
        direitosSuspensos += resultado.direitosSuspensos;
      } catch (erro: unknown) {
        falhas += 1;
        this.log.error(
          `falha ao aplicar inadimplencia do tenant ${tenantId}: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
        );
      }
    }

    return { tenants: tenants.length, direitosSuspensos, falhas };
  }
}
