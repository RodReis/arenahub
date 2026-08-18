import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

/**
 * Decisao sobre um evento de webhook do provedor. `MVP-02` 7 (Slice 2.2).
 *
 * Funcoes puras: sem banco, sem relogio, sem HTTP (`CLAUDE.md`). O que
 * decide se um evento muda estado e ISSO -- nao o caso de uso, que apenas
 * executa a decisao dentro da transacao.
 *
 * TRES INVARIANTES VIVEM AQUI:
 *
 *   - INV-076 -- duplicata: uma transicao logica por evento externo. A
 *     unicidade `(provider_account_id, external_event_id)` no banco e a
 *     guarda dura; esta funcao e a que sabe o que fazer quando ela dispara.
 *   - INV-079 -- fora de ordem: evento antigo nao regride estado terminal.
 *   - INV-069 (par no pagamento) -- `CONFIRMED` nao volta atras.
 *
 * O QUE ESTA FUNCAO NAO FAZ: verificar assinatura. Isso e INV-077 e
 * acontece ANTES, no boundary -- domínio nao conhece HMAC nem corpo bruto.
 */

/** Estado do pagamento no nosso lado. Espelha `PaymentStatus` do schema. */
export type StatusDoPagamento =
  | 'PENDING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

/**
 * Tipos de evento que ESTA fatia entende.
 *
 * Deliberadamente pequeno: F13 e PIX. Estorno (F15) e cartao (F14) trazem
 * os seus. Evento desconhecido nao e erro -- e registrado e ignorado, porque
 * provedor adiciona tipo novo sem avisar e derrubar o webhook por isso
 * causaria reentrega infinita.
 */
export type TipoDeEvento = 'PAYMENT_CONFIRMED' | 'PAYMENT_FAILED' | 'PAYMENT_CANCELLED';

/** Por que um evento nao mudou estado. Codigo estavel (`CLAUDE.md`). */
export type MotivoDeDescarte =
  | 'EVENTO_DUPLICADO'
  | 'EVENTO_FORA_DE_ORDEM'
  | 'TIPO_DESCONHECIDO'
  | 'ESTADO_TERMINAL';

export type DecisaoSobreEvento =
  | { aplicar: true; novoStatus: StatusDoPagamento }
  | { aplicar: false; motivo: MotivoDeDescarte };

export class EventoInvalidoError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_INVALID_PROVIDER_EVENT', 422, motivo);
  }
}

/**
 * Estados a partir dos quais nada mais muda por webhook.
 *
 * `CONFIRMED` esta aqui porque dinheiro que entrou nao desentra por evento
 * atrasado (INV-069). `REFUNDED` porque o estorno tem caminho proprio -- um
 * `PAYMENT_FAILED` chegando depois nao pode reescreve-lo.
 */
const TERMINAIS: readonly StatusDoPagamento[] = ['CONFIRMED', 'REFUNDED', 'CANCELLED'];

const STATUS_POR_TIPO: Readonly<Record<TipoDeEvento, StatusDoPagamento>> = {
  PAYMENT_CONFIRMED: 'CONFIRMED',
  PAYMENT_FAILED: 'FAILED',
  PAYMENT_CANCELLED: 'CANCELLED',
};

export function ehTipoConhecido(tipo: string): tipo is TipoDeEvento {
  return tipo in STATUS_POR_TIPO;
}

export interface EventoRecebido {
  /** Chave estavel do evento no provedor (INV-076). */
  externalEventId: string;
  tipo: string;
  /** Instante NO PROVEDOR. A ordem que importa e a da origem (INV-079). */
  occurredAt: Date;
}

export interface EstadoAtualDoPagamento {
  status: StatusDoPagamento;
  /**
   * `occurredAt` do ultimo evento JA APLICADO a este pagamento. Nulo quando
   * nenhum foi -- primeiro evento nunca esta fora de ordem.
   */
  ultimoEventoAplicadoEm: Date | null;
}

/**
 * Decide o que fazer com um evento verificado.
 *
 * `jaRecebido` vem do inbox: `true` quando a unicidade do banco ja tem esse
 * `(conta, evento)`. Reentrega e o caso NORMAL, nao a excecao -- provedor
 * reenvia por timeout, por retry, por reprocessamento manual. Por isso
 * duplicata e descarte silencioso e nao erro: devolver 4xx faria o provedor
 * reenviar de novo, para sempre.
 */
export function decidirSobreEvento(
  evento: EventoRecebido,
  atual: EstadoAtualDoPagamento,
  jaRecebido: boolean,
): DecisaoSobreEvento {
  if (evento.externalEventId.trim() === '') {
    throw new EventoInvalidoError('evento sem identificador externo nao e idempotente');
  }

  if (jaRecebido) {
    return { aplicar: false, motivo: 'EVENTO_DUPLICADO' };
  }

  if (!ehTipoConhecido(evento.tipo)) {
    return { aplicar: false, motivo: 'TIPO_DESCONHECIDO' };
  }

  if (TERMINAIS.includes(atual.status)) {
    return { aplicar: false, motivo: 'ESTADO_TERMINAL' };
  }

  /**
   * Empate (`<=`) conta como fora de ordem: dois eventos no mesmo instante
   * do provedor nao tem ordem definida, e aplicar o segundo seria escolher
   * um vencedor por acaso de chegada. O primeiro ja decidiu.
   */
  if (atual.ultimoEventoAplicadoEm !== null && evento.occurredAt <= atual.ultimoEventoAplicadoEm) {
    return { aplicar: false, motivo: 'EVENTO_FORA_DE_ORDEM' };
  }

  return { aplicar: true, novoStatus: STATUS_POR_TIPO[evento.tipo] };
}
