import type { EventoPendente, PortaDeDispatch } from './outbox-dispatcher.repository.js';

/** Dublê de `PortaDeDispatch` em memoria. Instancia NOVA por teste. */
export class FakePortaDeDispatch implements PortaDeDispatch {
  private eventos: EventoPendente[] = [];
  private publicados = new Set<string>();
  private recibos = new Set<string>();

  comEvento(evento: EventoPendente): void {
    this.eventos.push(evento);
  }

  async eventosPendentes(limite: number): Promise<readonly EventoPendente[]> {
    return this.eventos
      .filter((evento) => !this.publicados.has(evento.id))
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .slice(0, limite);
  }

  async jaProcessado(consumer: string, eventId: string): Promise<boolean> {
    return this.recibos.has(this.chave(consumer, eventId));
  }

  async registrarProcessado(consumer: string, eventId: string): Promise<void> {
    this.recibos.add(this.chave(consumer, eventId));
  }

  async marcarPublicado(eventId: string): Promise<void> {
    this.publicados.add(eventId);
  }

  private chave(consumer: string, eventId: string): string {
    return `${consumer}::${eventId}`;
  }
}
