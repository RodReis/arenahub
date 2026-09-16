import { Inject, Injectable, Logger } from '@nestjs/common';

import type { EventoDeOutbox } from './domain/mapa-de-avisos.js';
import { avisoParaEvento } from './domain/mapa-de-avisos.js';
import { PORTA_DE_AVISOS, type PortaDeAvisos } from './notifications-inbox.repository.js';
import type { ConsumidorDeEvento } from './outbox-dispatcher.service.js';

/** `avisoParaEvento` so retorna `null` quando o tipo nao esta no `switch`
 * -- nenhum ramo depende de `agora` para decidir SE trata, so para calcular
 * `expiresAt`. Uma data fixa e suficiente para perguntar "reconhece?". */
const DATA_QUALQUER_PARA_SONDAGEM = new Date(0);

/**
 * Consumidor de inbox in-app -- F73 §3. Grava `StudentNotification` a
 * partir de um `OutboxEvent`, quando o mapa de avisos reconhece o tipo.
 */
@Injectable()
export class NotificationsInboxConsumer implements ConsumidorDeEvento {
  readonly nome = 'notifications-inbox';

  private readonly log = new Logger(NotificationsInboxConsumer.name);

  constructor(@Inject(PORTA_DE_AVISOS) private readonly porta: PortaDeAvisos) {}

  trata(eventType: string): boolean {
    return (
      avisoParaEvento(
        { eventType, aggregateType: '', aggregateId: '', payload: {} },
        DATA_QUALQUER_PARA_SONDAGEM,
      ) !== null
    );
  }

  async processar(
    evento: EventoDeOutbox & { id: string; tenantId: string },
    agora: Date,
  ): Promise<void> {
    const aviso = avisoParaEvento(evento, agora);
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
