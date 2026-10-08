import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { comContexto } from '@arenahub/database';

import { BillingRepository } from './billing.repository.js';
import { jaChegouODiaDeGerar, FUSO_DOS_AGENDADORES } from './domain/configuracao-de-pagamento.js';
import { GerarFaturasDoMesUseCase, type ResultadoDaGeracao } from './gerar-faturas-do-mes.use-case.js';

/**
 * Fatura do mes no dia configurado de cada tenant (F88/F89; padrao: dia 01).
 * O job roda TODO dia as 00:05 de Brasilia e cada tenant gera no seu
 * `invoiceGenerationDay` E em todo dia seguinte do mesmo mes, ate a fatura
 * existir: assim o processo fora do ar no dia, ou o dono mudando o dia para um
 * que ja passou, nao deixam o mes sem fatura. Este job so decide QUANDO roda
 * `GerarFaturasDoMesUseCase`, que e reexecutavel (INV-066): nos dias
 * seguintes as faturas existentes so contam em `jaExistiam`. A rota
 * `billing/monthly-invoices/run` continua valida para reexecucao imediata.
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

  // Todo dia as 00:05; gera no dia configurado e nos dias seguintes do mes ate a
  // fatura existir; idempotente (INV-066); rota manual continua valida para
  // reexecucao imediata.
  @Cron('5 0 * * *', { name: 'gerar-faturas-do-mes', timeZone: FUSO_DOS_AGENDADORES })
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
   * pelo interceptor HTTP, e `students` tem RLS. `foraDoDia` conta os tenants
   * cujo dia de gerar ainda nao chegou neste mes.
   */
  async executarCiclo(agora: Date): Promise<ResultadoDaGeracao & { tenants: number; foraDoDia: number }> {
    const tenants = await this.repositorio.listarTenantsAtivos();

    let elegiveis = 0;
    let criadas = 0;
    let jaExistiam = 0;
    let falhas = 0;
    let foraDoDia = 0;

    for (const tenantId of tenants) {
      try {
        const resultado = await comContexto({ kind: 'tenant', tenantId }, async () => {
          const dia = await this.repositorio.diaDeGerarFaturas(tenantId);
          if (!jaChegouODiaDeGerar(agora, dia)) return null;

          return this.gerar.executar(tenantId, agora);
        });

        if (resultado === null) {
          foraDoDia += 1;
          continue;
        }

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

    return { tenants: tenants.length, foraDoDia, elegiveis, criadas, jaExistiam, falhas };
  }
}
