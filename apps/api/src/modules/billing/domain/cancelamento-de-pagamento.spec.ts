import { describe, expect, it } from '@jest/globals';

import {
  CancelamentoInvalidoError,
  CreditoJaAplicadoError,
  PagamentoNaoCancelavelError,
  creditoAConsumir,
  decidirCancelamento,
  deveRestaurarVencimento,
  diaDoPagamento,
  podeCancelarPagamento,
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

/**
 * Regra de QUANDO se cancela -- decisao do PI em 05/10/2026, depois da F85:
 * "so pode cancelar o que esta adiantado ou mais de 1 pagamento no mesmo mes,
 * e mes que ja passou NAO se cancela". "Mesmo mes" = mesma COMPETENCIA com 2+
 * pagamentos confirmados; mes corrente com um pagamento so NAO cancela.
 */
describe('decidirCancelamento', () => {
  const AGORA = new Date('2026-10-05T19:13:00Z'); // competencia corrente: out/26
  const mes = (iso: string) => new Date(`${iso}-01T00:00:00Z`);

  it('mes adiantado com um pagamento: cancela e reabre a fatura', () => {
    expect(decidirCancelamento({ competencia: mes('2026-11'), agora: AGORA, confirmadosNaFatura: 1 })).toBe(
      'REABRE_FATURA',
    );
  });

  it('mes adiantado com dois pagamentos: cancela o extra e a fatura continua paga', () => {
    expect(decidirCancelamento({ competencia: mes('2026-11'), agora: AGORA, confirmadosNaFatura: 2 })).toBe(
      'FATURA_CONTINUA_PAGA',
    );
  });

  it('mes corrente com dois pagamentos: cancela o extra', () => {
    expect(decidirCancelamento({ competencia: mes('2026-10'), agora: AGORA, confirmadosNaFatura: 2 })).toBe(
      'FATURA_CONTINUA_PAGA',
    );
  });

  it('mes corrente com um pagamento so: recusa', () => {
    expect(() => decidirCancelamento({ competencia: mes('2026-10'), agora: AGORA, confirmadosNaFatura: 1 })).toThrow(
      PagamentoNaoCancelavelError,
    );
  });

  it.each([1, 2])('mes que ja passou nunca cancela (%i pagamento[s])', (confirmadosNaFatura) => {
    expect(() => decidirCancelamento({ competencia: mes('2026-09'), agora: AGORA, confirmadosNaFatura })).toThrow(
      PagamentoNaoCancelavelError,
    );
  });
});

describe('podeCancelarPagamento', () => {
  const AGORA = new Date('2026-10-05T19:13:00Z');
  const base = { method: 'MANUAL', status: 'CONFIRMED', competencia: new Date('2026-11-01T00:00:00Z'), agora: AGORA, confirmadosNaFatura: 1 };

  it('responde a mesma regra sem lancar, para a tela decidir se mostra a acao', () => {
    expect(podeCancelarPagamento(base)).toBe(true);
    expect(podeCancelarPagamento({ ...base, competencia: new Date('2026-10-01T00:00:00Z') })).toBe(false);
    expect(podeCancelarPagamento({ ...base, method: 'PIX' })).toBe(false);
    expect(podeCancelarPagamento({ ...base, status: 'CANCELLED' })).toBe(false);
  });
});

describe('creditoAConsumir', () => {
  it('cancelar o pagamento EXTRA (todo em credito) nao consome credito de ninguem', () => {
    expect(
      creditoAConsumir({
        totalDaFaturaMinor: 15000,
        pagoNoCanceladoMinor: 15000,
        creditoDoCanceladoMinor: 15000,
        creditosDisponiveisDosOutros: [],
      }),
    ).toBeNull();
  });

  it('cancelar o pagamento que QUITOU a fatura passa a quitacao ao outro: consome o credito dele', () => {
    expect(
      creditoAConsumir({
        totalDaFaturaMinor: 15000,
        pagoNoCanceladoMinor: 15000,
        creditoDoCanceladoMinor: 0,
        creditosDisponiveisDosOutros: [{ id: 'c-pix', amountMinor: 15000 }],
      }),
    ).toEqual({ creditId: 'c-pix', restanteMinor: 0 });
  });

  it('credito maior que a fatura: consome so o total e o resto continua disponivel', () => {
    expect(
      creditoAConsumir({
        totalDaFaturaMinor: 15000,
        pagoNoCanceladoMinor: 15000,
        creditoDoCanceladoMinor: 0,
        creditosDisponiveisDosOutros: [{ id: 'c-pix', amountMinor: 20000 }],
      }),
    ).toEqual({ creditId: 'c-pix', restanteMinor: 5000 });
  });

  it('quitador cancelado e o outro sem credito disponivel que cubra: recusa', () => {
    expect(() =>
      creditoAConsumir({
        totalDaFaturaMinor: 15000,
        pagoNoCanceladoMinor: 15000,
        creditoDoCanceladoMinor: 0,
        creditosDisponiveisDosOutros: [{ id: 'c-pix', amountMinor: 9000 }],
      }),
    ).toThrow(CreditoJaAplicadoError);
  });
});
