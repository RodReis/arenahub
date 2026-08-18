import { describe, expect, it } from '@jest/globals';

import {
  EventoInvalidoError,
  decidirSobreEvento,
  ehTipoConhecido,
  type EstadoAtualDoPagamento,
  type EventoRecebido,
} from './evento-do-provedor.js';

/**
 * Idempotencia e ordenacao do webhook -- o aceite da Slice 2.2:
 * "PIX sandbox e homologacao atualizam o acesso UMA UNICA VEZ mesmo com
 * webhook repetido".
 *
 * Funcao pura: o instante do provedor entra por parametro (`CLAUDE.md`).
 * Relogio local nao decide ordem de evento de terceiro.
 */

const PENDENTE: EstadoAtualDoPagamento = { status: 'PENDING', ultimoEventoAplicadoEm: null };

function evento(sobrescreve: Partial<EventoRecebido> = {}): EventoRecebido {
  return {
    externalEventId: 'evt_001',
    tipo: 'PAYMENT_CONFIRMED',
    occurredAt: new Date('2026-08-18T12:00:00Z'),
    ...sobrescreve,
  };
}

describe('decidirSobreEvento -- caminho feliz', () => {
  it('confirma pagamento pendente', () => {
    expect(decidirSobreEvento(evento(), PENDENTE, false)).toEqual({
      aplicar: true,
      novoStatus: 'CONFIRMED',
    });
  });

  it('falha de pagamento leva a FAILED, que nao e terminal', () => {
    expect(decidirSobreEvento(evento({ tipo: 'PAYMENT_FAILED' }), PENDENTE, false)).toEqual({
      aplicar: true,
      novoStatus: 'FAILED',
    });
  });

  it('pagamento que falhou ainda pode ser confirmado depois', () => {
    const aposFalha: EstadoAtualDoPagamento = {
      status: 'FAILED',
      ultimoEventoAplicadoEm: new Date('2026-08-18T12:00:00Z'),
    };

    expect(
      decidirSobreEvento(evento({ externalEventId: 'evt_002', occurredAt: new Date('2026-08-18T12:05:00Z') }), aposFalha, false),
    ).toEqual({ aplicar: true, novoStatus: 'CONFIRMED' });
  });
});

describe('decidirSobreEvento -- INV-076, duplicata', () => {
  it('evento ja recebido nao aplica de novo', () => {
    expect(decidirSobreEvento(evento(), PENDENTE, true)).toEqual({
      aplicar: false,
      motivo: 'EVENTO_DUPLICADO',
    });
  });

  it('duplicata vence ate sobre pagamento pendente e evento valido -- e o aceite da slice', () => {
    const decisoes = [false, true, true, true].map((jaRecebido) =>
      decidirSobreEvento(evento(), PENDENTE, jaRecebido),
    );

    expect(decisoes.filter((d) => d.aplicar)).toHaveLength(1);
  });

  it('evento sem identificador externo nao e idempotente e e recusado', () => {
    expect(() => decidirSobreEvento(evento({ externalEventId: '  ' }), PENDENTE, false)).toThrow(
      EventoInvalidoError,
    );
  });
});

describe('decidirSobreEvento -- INV-079, fora de ordem', () => {
  const jaAplicado: EstadoAtualDoPagamento = {
    status: 'PENDING',
    ultimoEventoAplicadoEm: new Date('2026-08-18T12:00:00Z'),
  };

  it('evento anterior ao ultimo aplicado nao regride', () => {
    expect(
      decidirSobreEvento(evento({ occurredAt: new Date('2026-08-18T11:59:00Z') }), jaAplicado, false),
    ).toEqual({ aplicar: false, motivo: 'EVENTO_FORA_DE_ORDEM' });
  });

  it('empate no instante do provedor tambem nao aplica -- ordem indefinida nao se decide por acaso de chegada', () => {
    expect(
      decidirSobreEvento(evento({ occurredAt: new Date('2026-08-18T12:00:00Z') }), jaAplicado, false),
    ).toEqual({ aplicar: false, motivo: 'EVENTO_FORA_DE_ORDEM' });
  });

  it('evento posterior aplica normalmente', () => {
    expect(
      decidirSobreEvento(evento({ occurredAt: new Date('2026-08-18T12:00:01Z') }), jaAplicado, false),
    ).toEqual({ aplicar: true, novoStatus: 'CONFIRMED' });
  });

  it('primeiro evento nunca esta fora de ordem', () => {
    expect(
      decidirSobreEvento(evento({ occurredAt: new Date('2020-01-01T00:00:00Z') }), PENDENTE, false),
    ).toEqual({ aplicar: true, novoStatus: 'CONFIRMED' });
  });
});

describe('decidirSobreEvento -- INV-069, estado terminal', () => {
  it.each(['CONFIRMED', 'REFUNDED', 'CANCELLED'] as const)(
    '%s nao volta atras por webhook',
    (status) => {
      const terminal: EstadoAtualDoPagamento = {
        status,
        ultimoEventoAplicadoEm: new Date('2026-08-18T12:00:00Z'),
      };

      expect(
        decidirSobreEvento(
          evento({ tipo: 'PAYMENT_FAILED', occurredAt: new Date('2026-08-18T13:00:00Z') }),
          terminal,
          false,
        ),
      ).toEqual({ aplicar: false, motivo: 'ESTADO_TERMINAL' });
    },
  );
});

describe('decidirSobreEvento -- tipo desconhecido', () => {
  it('tipo novo do provedor e ignorado, nao rejeitado', () => {
    expect(decidirSobreEvento(evento({ tipo: 'PAYMENT_DISPUTED' }), PENDENTE, false)).toEqual({
      aplicar: false,
      motivo: 'TIPO_DESCONHECIDO',
    });
  });

  it('ehTipoConhecido reconhece apenas o que a fatia trata', () => {
    expect(ehTipoConhecido('PAYMENT_CONFIRMED')).toBe(true);
    expect(ehTipoConhecido('SUBSCRIPTION_RENEWED')).toBe(false);
  });
});
