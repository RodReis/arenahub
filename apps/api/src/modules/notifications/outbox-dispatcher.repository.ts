import type { EventoDeOutbox } from './domain/mapa-de-avisos.js';

/** Token de injecao da porta -- o modulo Nest liga isto ao repositorio Prisma. */
export const PORTA_DE_DISPATCH = Symbol('PortaDeDispatch');

/**
 * O que o despachante precisa do outbox -- ver spec da F73 §2.
 *
 * `jaProcessado`/`registrarProcessado` sao a idempotencia de verdade
 * (`InboxReceipt`, chave unica `(consumer, eventId)`). `marcarPublicado` e
 * so housekeeping: nunca e o que impede reprocessamento.
 */
export interface PortaDeDispatch {
  /** Eventos ainda nao processados por TODOS os consumidores, mais antigos
   * primeiro, ate `limite`. */
  eventosPendentes(limite: number): Promise<readonly EventoPendente[]>;

  jaProcessado(consumer: string, eventId: string): Promise<boolean>;

  /** Registra o recibo. Deve ser idempotente: chamar duas vezes para o
   * mesmo par nao pode lancar nem duplicar. */
  registrarProcessado(consumer: string, eventId: string): Promise<void>;

  marcarPublicado(eventId: string): Promise<void>;
}

export interface EventoPendente extends EventoDeOutbox {
  readonly id: string;
  readonly tenantId: string;
  readonly occurredAt: Date;
}
