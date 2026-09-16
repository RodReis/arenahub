import { Inject, Injectable, Logger } from '@nestjs/common';

import type { EventoDeOutbox } from './domain/mapa-de-avisos.js';
import { avisoParaEvento } from './domain/mapa-de-avisos.js';
import { PORTA_DE_AVISOS, type PortaDeAvisos } from './notifications-inbox.repository.js';
import type { ConsumidorDeEvento } from './outbox-dispatcher.service.js';

/**
 * Consumidor de inbox in-app -- F73 §3. Grava `StudentNotification` a
 * partir de um `OutboxEvent`, quando o mapa de avisos reconhece o tipo.
 *
 * `agora` chega como funcao (nao valor), porque o consumidor e resolvido
 * uma vez pelo Nest e chamado a cada ciclo do despachante -- capturar um
 * `Date` fixo na construcao congelaria o relogio.
 */
@Injectable()
export class NotificationsInboxConsumer implements ConsumidorDeEvento {
  readonly nome = 'notifications-inbox';

  private readonly log = new Logger(NotificationsInboxConsumer.name);

  constructor(
    @Inject(PORTA_DE_AVISOS) private readonly porta: PortaDeAvisos,
    private readonly agora: () => Date,
  ) {}

  trata(eventType: string): boolean {
    return avisoParaEvento({ eventType, aggregateType: '', aggregateId: '', payload: {} }, this.agora()) !== null;
  }

  async processar(evento: EventoDeOutbox & { id: string; tenantId: string }): Promise<void> {
    const aviso = avisoParaEvento(evento, this.agora());
    if (aviso === null) return;

    const studentId = await this.resolverStudentId(evento);
    if (studentId === null) {
      this.log.warn(
        `evento ${evento.eventType} (${evento.id}) sem aluno resolvivel a partir de ` +
          `${evento.aggregateType}/${evento.aggregateId} -- aviso nao gravado`,
      );

      return;
    }

    await this.porta.gravar(evento.tenantId, studentId, aviso);
  }

  /** `Student` e o proprio aluno; qualquer outro agregado precisa de join. */
  private async resolverStudentId(
    evento: EventoDeOutbox & { id: string; tenantId: string },
  ): Promise<string | null> {
    if (evento.aggregateType === 'Student') return evento.aggregateId;

    return this.porta.resolverStudentId(evento.aggregateType, evento.aggregateId);
  }
}
