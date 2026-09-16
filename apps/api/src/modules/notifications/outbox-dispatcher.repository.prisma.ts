import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { EventoPendente, PortaDeDispatch } from './outbox-dispatcher.repository.js';

/** Teto de idade do outbox considerado -- protege contra full scan de
 * eventos antigos que todo consumidor ja processou ha muito tempo. */
const JANELA_EM_DIAS = 7;

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
    const desde = new Date(Date.now() - JANELA_EM_DIAS * 24 * 60 * 60 * 1000);

    const eventos = await this.db.outboxEvent.findMany({
      where: { occurredAt: { gte: desde } },
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
