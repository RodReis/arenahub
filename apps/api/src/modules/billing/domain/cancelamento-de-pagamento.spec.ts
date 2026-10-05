import { describe, expect, it } from '@jest/globals';

import {
  CancelamentoInvalidoError,
  PagamentoNaoCancelavelError,
  deveRestaurarVencimento,
  diaDoPagamento,
  validarCancelamento,
} from './cancelamento-de-pagamento.js';

/**
 * Regras do cancelamento de pagamento manual. F85, decisao do PI em
 * 05/10/2026 (emenda do INV-069 so para pagamento MANUAL).
 */
describe('validarCancelamento', () => {
  const manualConfirmado = { method: 'MANUAL', status: 'CONFIRMED' };

  it('aceita pagamento manual confirmado com motivo', () => {
    expect(() => validarCancelamento(manualConfirmado, 'lancei no aluno errado')).not.toThrow();
  });

  it('recusa PIX e cartao: o caminho deles e o estorno com provedor', () => {
    expect(() => validarCancelamento({ method: 'PIX', status: 'CONFIRMED' }, 'motivo ok')).toThrow(
      PagamentoNaoCancelavelError,
    );
    expect(() => validarCancelamento({ method: 'CARD', status: 'CONFIRMED' }, 'motivo ok')).toThrow(
      PagamentoNaoCancelavelError,
    );
  });

  it.each(['CANCELLED', 'REFUNDED', 'PENDING', 'FAILED', 'REFUND_PENDING'])(
    'recusa pagamento em %s',
    (status) => {
      expect(() => validarCancelamento({ method: 'MANUAL', status }, 'motivo ok')).toThrow(
        PagamentoNaoCancelavelError,
      );
    },
  );

  it('recusa motivo curto ou so de espacos', () => {
    expect(() => validarCancelamento(manualConfirmado, 'ab')).toThrow(CancelamentoInvalidoError);
    expect(() => validarCancelamento(manualConfirmado, '   ab   ')).toThrow(CancelamentoInvalidoError);
  });

  it('checa o metodo ANTES do motivo: PIX com motivo vazio diz "nao cancelavel", nao "motivo"', () => {
    expect(() => validarCancelamento({ method: 'PIX', status: 'CONFIRMED' }, '')).toThrow(
      PagamentoNaoCancelavelError,
    );
  });
});

describe('diaDoPagamento', () => {
  it('devolve a meia-noite UTC do dia UTC do instante', () => {
    expect(diaDoPagamento(new Date('2026-10-05T19:13:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(diaDoPagamento(new Date('2026-10-05T12:00:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });
});

describe('deveRestaurarVencimento', () => {
  const paidAt = new Date('2026-10-05T19:13:00Z');

  it('restaura quando o vencimento e exatamente o gravado pelo lote de 1 mes (05/10 + 30 dias)', () => {
    expect(
      deveRestaurarVencimento({
        dueAtAtual: new Date('2026-11-04T00:00:00Z'),
        paidAt,
        tamanhoDoLote: 1,
        confirmadosRestantesNoLote: 0,
      }),
    ).toBe(true);
  });

  it('restaura com lote de 2 meses quando o vencimento e 05/10 + 60 dias', () => {
    expect(
      deveRestaurarVencimento({
        dueAtAtual: new Date('2026-12-04T00:00:00Z'),
        paidAt,
        tamanhoDoLote: 2,
        confirmadosRestantesNoLote: 0,
      }),
    ).toBe(true);
  });

  it('nao restaura quando o vencimento e outro (alguem ja mexeu nele)', () => {
    expect(
      deveRestaurarVencimento({
        dueAtAtual: new Date('2026-11-20T00:00:00Z'),
        paidAt,
        tamanhoDoLote: 1,
        confirmadosRestantesNoLote: 0,
      }),
    ).toBe(false);
  });

  it('nao restaura enquanto sobrar pagamento confirmado no lote', () => {
    expect(
      deveRestaurarVencimento({
        dueAtAtual: new Date('2026-12-04T00:00:00Z'),
        paidAt,
        tamanhoDoLote: 2,
        confirmadosRestantesNoLote: 1,
      }),
    ).toBe(false);
  });

  it('nao confunde o tamanho do lote: vencimento de 2 meses num lote de 1 nao casa', () => {
    expect(
      deveRestaurarVencimento({
        dueAtAtual: new Date('2026-12-04T00:00:00Z'),
        paidAt,
        tamanhoDoLote: 1,
        confirmadosRestantesNoLote: 0,
      }),
    ).toBe(false);
  });
});
