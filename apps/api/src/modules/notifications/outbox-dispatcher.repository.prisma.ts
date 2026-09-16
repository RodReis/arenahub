import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { EventoPendente, PortaDeDispatch } from './outbox-dispatcher.repository.js';

/**
 * `OutboxEvent`/`InboxReceipt` NAO tem politica RLS (so `Student` e
 * `AuditLog` tem, ver `MODELOS_COM_RLS`) -- `this.db` direto e correto
 * aqui, sem `comTenant`. O despachante e CROSS-TENANT por natureza: ele
 * nao age em nome de uma requisicao de um tenant, ele varre o outbox de
 * todos.
 */
@Injectable()
export class OutboxDispatcherRepository implements PortaDeDispatch {
  constructor(private readonly db: PrismaService) {}

  async eventosPendentes(limite: number): Promise<readonly EventoPendente[]> {
    /*
     * `publishedAt IS NULL` -- SEM ISSO O CICLO NUNCA PROGRIDE. Um evento
     * marcado como publicado ja teve todos os consumidores REGISTRADOS
     * tentando-o (ver `marcarPublicado`); reincluir esses eventos a cada
     * ciclo faria os `TETO_POR_CICLO` mais antigos represar o despachante
     * para sempre sob acumulo -- achado real no teste de integracao F73
     * contra banco compartilhado com outbox historico de outras suites.
     *
     * Trade-off aceito: um consumidor NOVO, registrado depois que um
     * evento ja foi `publishedAt`, nao vera esse evento antigo. Aceitavel
     * porque a idempotencia de negocio (InboxReceipt) e por consumidor, e
     * o caso de "consumidor novo precisa reprocessar historico" e raro e
     * pode ser feito por script pontual, nao pelo ciclo normal.
     */
    const eventos = await this.db.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { occurredAt: 'asc' },
      take: limite,
    });

    return eventos.map((evento) => ({
      id: evento.id,
      tenantId: evento.tenantId,
      eventType: evento.eventType,
      aggregateType: evento.aggregateType,
      aggregateId: evento.aggregateId,
      payload: evento.payload as Record<string, unknown>,
      occurredAt: evento.occurredAt,
    }));
  }

  async jaProcessado(consumer: string, eventId: string): Promise<boolean> {
    const recibo = await this.db.inboxReceipt.findUnique({
      where: { consumer_eventId: { consumer, eventId } },
      select: { id: true },
    });

    return recibo !== null;
  }

  async registrarProcessado(consumer: string, eventId: string): Promise<void> {
    // upsert: registrar duas vezes o mesmo par nao pode lancar. Duas
    // execucoes concorrentes do mesmo evento colidem aqui, e a segunda so
    // confirma o que a primeira ja gravou.
    await this.db.inboxReceipt.upsert({
      where: { consumer_eventId: { consumer, eventId } },
      create: { consumer, eventId },
      update: {},
    });
  }

  async marcarPublicado(eventId: string): Promise<void> {
    await this.db.outboxEvent.update({
      where: { id: eventId },
      data: { publishedAt: new Date() },
    });
  }
}
