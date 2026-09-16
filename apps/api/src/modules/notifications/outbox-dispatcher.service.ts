import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import type { EventoDeOutbox } from './domain/mapa-de-avisos.js';
import { PORTA_DE_DISPATCH, type EventoPendente, type PortaDeDispatch } from './outbox-dispatcher.repository.js';

/** Um consumidor do outbox: decide se trata o `eventType` e o que fazer. */
export interface ConsumidorDeEvento {
  readonly nome: string;
  trata(eventType: string): boolean;
  processar(evento: EventoDeOutbox & { id: string; tenantId: string }): Promise<void>;
}

/** Teto de eventos processados por ciclo -- protege contra fila represada. */
const TETO_POR_CICLO = 200;

/** Token de injecao da lista de consumidores -- o modulo Nest agrega os
 * providers marcados `CONSUMIDOR_DE_EVENTO` neste array. */
export const CONSUMIDORES_DE_EVENTO = Symbol('ConsumidoresDeEvento');

/**
 * Despachante de outbox -- F73, ADR-058.
 *
 * ESPELHA `EngagementRankingSchedulerService`/`PlatformInvoiceSchedulerService`
 * de proposito: mesmo precedente, mesmas quatro garantias.
 *   - `@Cron` do `@nestjs/schedule`, ja ligado em `app.module.ts`;
 *   - trava de reentrada NO PROCESSO;
 *   - `agora` INJETADO -- o teste nao espera o minuto seguinte;
 *   - falha de UM CONSUMIDOR nao impede os outros nem os outros eventos.
 *
 * A IDEMPOTENCIA DE VERDADE e o `InboxReceipt` (chave unica
 * `(consumer, eventId)`), nao o `publishedAt` do evento -- ver spec da F73
 * §2.2. Dois ciclos concorrentes no mesmo evento: o segundo bate no recibo
 * ja gravado e pula, sem duplicar aviso nem XP.
 */
@Injectable()
export class OutboxDispatcherService {
  private readonly log = new Logger(OutboxDispatcherService.name);

  /** Trava de reentrada -- ver `EngagementRankingSchedulerService.fechando`. */
  private despachando = false;

  constructor(
    @Inject(PORTA_DE_DISPATCH) private readonly porta: PortaDeDispatch,
    @Inject(CONSUMIDORES_DE_EVENTO) private readonly consumidores: readonly ConsumidorDeEvento[],
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'despacho-de-outbox' })
  async despachar(): Promise<void> {
    if (this.despachando) {
      this.log.warn('despacho anterior ainda em curso; pulando este ciclo');

      return;
    }

    this.despachando = true;

    try {
      await this.executarCiclo(new Date());
    } finally {
      this.despachando = false;
    }
  }

  /** Um ciclo completo. `agora` injetado -- o teste nao espera o minuto. */
  async executarCiclo(
    _agora: Date,
  ): Promise<{ eventos: number; entregas: number; falhas: number }> {
    const eventos = await this.porta.eventosPendentes(TETO_POR_CICLO);

    let entregas = 0;
    let falhas = 0;

    for (const evento of eventos) {
      const resultado = await this.entregar(evento);
      entregas += resultado.entregas;
      falhas += resultado.falhas;

      await this.porta.marcarPublicado(evento.id);
    }

    return { eventos: eventos.length, entregas, falhas };
  }

  /** Entrega UM evento a todos os consumidores interessados. Falha de um
   * consumidor vira log e nao impede os demais. */
  private async entregar(
    evento: EventoPendente,
  ): Promise<{ entregas: number; falhas: number }> {
    let entregas = 0;
    let falhas = 0;

    for (const consumidor of this.consumidores) {
      if (!consumidor.trata(evento.eventType)) continue;

      const jaProcessado = await this.porta.jaProcessado(consumidor.nome, evento.id);
      if (jaProcessado) continue;

      try {
        await consumidor.processar(evento);
        await this.porta.registrarProcessado(consumidor.nome, evento.id);
        entregas += 1;
      } catch (erro: unknown) {
        falhas += 1;

        // Sem o objeto de erro cru: pode carregar trecho de payload com
        // dado de aluno. O eventType e o consumidor bastam para investigar.
        this.log.error(
          `falha ao entregar evento ${evento.eventType} (${evento.id}) ao consumidor ` +
            `${consumidor.nome}: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
        );
      }
    }

    return { entregas, falhas };
  }
}
