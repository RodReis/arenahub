import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { competenciaDe } from './domain/calculo-da-fatura.js';
import { PlatformInvoiceUseCase } from './platform-invoice.use-case.js';

/** Correlacao das escritas do job -- nao ha requisicao HTTP por tras. */
const CORRELACAO_DO_JOB = 'platform-invoice-scheduler';

/**
 * Emissao automatica da fatura da plataforma -- F64, ADR-052.
 *
 * ESPELHA `EngagementRankingSchedulerService` de proposito: mesmo precedente,
 * mesmas quatro garantias.
 *   - `@Cron` do `@nestjs/schedule`, ja ligado em `app.module.ts`;
 *   - trava de reentrada NO PROCESSO (nao substitui a chave unica do banco,
 *     protege de uma execucao lenta receber a proxima por cima);
 *   - `agora` INJETADO -- o teste nao espera um mes;
 *   - falha de um tenant NAO derruba os outros: vira log e o laco segue.
 *
 * DIARIO e nao mensal, pela mesma razao de la: um `@Cron` de meia-noite que
 * pergunta "hoje e dia de emitir e a competencia ainda nao tem fatura?" e
 * mais simples de raciocinar do que agendar por dia do mes -- e converge
 * identico, porque nos outros dias a resposta e nao. O dia perdido por uma
 * API fora do ar tambem se recupera sozinho no dia seguinte, que e o que um
 * `@Cron` no dia exato nao faria.
 */
@Injectable()
export class PlatformInvoiceSchedulerService {
  private readonly log = new Logger(PlatformInvoiceSchedulerService.name);

  /** Trava de reentrada -- ver `EngagementRankingSchedulerService.fechando`. */
  private emitindo = false;

  constructor(private readonly faturas: PlatformInvoiceUseCase) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'emissao-de-fatura-da-plataforma' })
  async emitir(): Promise<void> {
    if (this.emitindo) {
      this.log.warn('emissão anterior ainda em curso; pulando este ciclo');

      return;
    }

    this.emitindo = true;

    try {
      await this.executarCiclo(new Date());
    } finally {
      this.emitindo = false;
    }
  }

  /**
   * Um ciclo completo. `agora` injetado -- o teste nao espera um mes.
   *
   * ORDEM: emite primeiro, marca vencidas depois. Ao contrario, uma fatura
   * emitida hoje com vencimento hoje ja nasceria vencida no mesmo ciclo.
   */
  async executarCiclo(
    agora: Date,
  ): Promise<{ contratos: number; emitidas: number; vencidas: number; falhas: number }> {
    const contratos = await this.faturas.contratosVigentes();

    let emitidas = 0;
    let falhas = 0;

    for (const contrato of contratos) {
      /*
       * SO NO DIA DE EMISSAO do proprio contrato. O job roda todo dia, mas a
       * fatura do tenant sai no `issueDay` dele -- emitir antes cobraria uma
       * contagem que ainda vai mudar, e a contagem e congelada.
       */
      if (agora.getUTCDate() !== contrato.issueDay) continue;

      try {
        const { criada } = await this.faturas.emitir(
          contrato.tenantId,
          agora,
          null,
          CORRELACAO_DO_JOB,
        );

        // `criada: false` e a competencia ja faturada -- o caso normal de
        // reexecucao, nao um erro. Nao conta como emitida nem como falha.
        if (criada) emitidas += 1;
      } catch (erro: unknown) {
        falhas += 1;

        // Sem o objeto de erro cru: pode carregar trecho de query com dado de
        // aluno. O tenant e a competencia bastam para investigar.
        this.log.error(
          `falha ao emitir fatura do tenant ${contrato.tenantId} na competência ` +
            `${competenciaDe(agora).toISOString().slice(0, 7)}: ` +
            `${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
        );
      }
    }

    const vencidas = await this.faturas.marcarVencidas(agora);

    return { contratos: contratos.length, emitidas, vencidas, falhas };
  }
}
