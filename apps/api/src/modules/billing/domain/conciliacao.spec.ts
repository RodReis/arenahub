import { describe, expect, it } from '@jest/globals';

import {
  conciliar,
  contarEmAberto,
  type MovimentoExterno,
  type MovimentoInterno,
} from './conciliacao.js';

/**
 * Matriz de casamento da conciliacao. F16, `M2-FR-019`, `M2-AC-010`.
 *
 * O que estes testes protegem e a afirmacao "conciliei 100%": um casamento
 * frouxo fecha em zero divergencia e parece perfeito -- exatamente o resultado
 * que a academia veria se a funcao casasse pelo valor em vez da chave.
 */

const PAGAMENTO_INTERNO: MovimentoInterno = {
  id: 'pay_1',
  externalPaymentId: 'fake_pay_1',
  tipo: 'PAYMENT',
  amountMinor: 12_000,
  currency: 'BRL',
};

const PAGAMENTO_EXTERNO: MovimentoExterno = {
  externalMovementId: 'mov_1',
  externalPaymentId: 'fake_pay_1',
  tipo: 'PAYMENT',
  amountMinor: 12_000,
  currency: 'BRL',
};

describe('conciliar', () => {
  it('mesma chave e mesmo valor: MATCHED', () => {
    const itens = conciliar([PAGAMENTO_INTERNO], [PAGAMENTO_EXTERNO]);

    expect(itens).toHaveLength(1);
    expect(itens[0]?.status).toBe('MATCHED');
    expect(itens[0]?.paymentId).toBe('pay_1');
    expect(itens[0]?.externalMovementId).toBe('mov_1');
  });

  it('provedor tem e nos nao: MISSING_INTERNAL', () => {
    const itens = conciliar([], [PAGAMENTO_EXTERNO]);

    expect(itens[0]?.status).toBe('MISSING_INTERNAL');
    expect(itens[0]?.internalAmountMinor).toBeNull();
    expect(itens[0]?.externalAmountMinor).toBe(12_000);
  });

  it('nos temos e o provedor nao reporta: MISSING_EXTERNAL', () => {
    const itens = conciliar([PAGAMENTO_INTERNO], []);

    expect(itens[0]?.status).toBe('MISSING_EXTERNAL');
    expect(itens[0]?.internalAmountMinor).toBe(12_000);
    expect(itens[0]?.externalAmountMinor).toBeNull();
  });

  it('mesma chave, valor diferente: AMOUNT_MISMATCH com os dois lados visiveis', () => {
    const itens = conciliar(
      [PAGAMENTO_INTERNO],
      [{ ...PAGAMENTO_EXTERNO, amountMinor: 11_640 }],
    );

    expect(itens[0]?.status).toBe('AMOUNT_MISMATCH');
    expect(itens[0]?.internalAmountMinor).toBe(12_000);
    expect(itens[0]?.externalAmountMinor).toBe(11_640);
  });

  it('moeda diferente tambem e AMOUNT_MISMATCH -- mesma acao para o operador', () => {
    const itens = conciliar([PAGAMENTO_INTERNO], [{ ...PAGAMENTO_EXTERNO, currency: 'USD' }]);

    expect(itens[0]?.status).toBe('AMOUNT_MISMATCH');
  });

  it('PAGAMENTO E ESTORNO DE MESMO VALOR NAO SE ANULAM', () => {
    // O caso que engana: R$ 120 cobrados e R$ 120 estornados produzem dois
    // movimentos com o MESMO `externalPaymentId` e valores identicos. Casar
    // so pelo pagamento faria os dois baterem entre si, a conciliacao fechar
    // em zero -- e o dinheiro ter ido e voltado sem nenhuma ponta registrada.
    const internos: MovimentoInterno[] = [
      PAGAMENTO_INTERNO,
      { id: 'ref_1', externalPaymentId: 'fake_pay_1', tipo: 'REFUND', amountMinor: 12_000, currency: 'BRL' },
    ];
    const externos: MovimentoExterno[] = [
      PAGAMENTO_EXTERNO,
      { externalMovementId: 'mov_2', externalPaymentId: 'fake_pay_1', tipo: 'REFUND', amountMinor: 12_000, currency: 'BRL' },
    ];

    const itens = conciliar(internos, externos);

    expect(itens).toHaveLength(2);
    expect(itens.every((i) => i.status === 'MATCHED')).toBe(true);
    expect(itens.find((i) => i.refundId === 'ref_1')?.externalMovementId).toBe('mov_2');
    expect(itens.find((i) => i.paymentId === 'pay_1')?.externalMovementId).toBe('mov_1');
  });

  it('estorno so do nosso lado nao casa com a cobranca do provedor', () => {
    const internos: MovimentoInterno[] = [
      { id: 'ref_1', externalPaymentId: 'fake_pay_1', tipo: 'REFUND', amountMinor: 12_000, currency: 'BRL' },
    ];

    const itens = conciliar(internos, [PAGAMENTO_EXTERNO]);

    // Duas linhas, nao uma: o estorno nosso ficou sem par, e a cobranca do
    // provedor tambem. Um casamento por valor teria dado MATCHED.
    expect(itens).toHaveLength(2);
    expect(itens.map((i) => i.status).sort()).toEqual(['MISSING_EXTERNAL', 'MISSING_INTERNAL']);
  });

  it('TODO movimento vira linha, inclusive o que bateu', () => {
    const internos: MovimentoInterno[] = [
      PAGAMENTO_INTERNO,
      { ...PAGAMENTO_INTERNO, id: 'pay_2', externalPaymentId: 'fake_pay_2' },
    ];
    const externos: MovimentoExterno[] = [
      PAGAMENTO_EXTERNO,
      { ...PAGAMENTO_EXTERNO, externalMovementId: 'mov_3', externalPaymentId: 'fake_pay_3' },
    ];

    const itens = conciliar(internos, externos);

    // 1 MATCHED + 1 MISSING_EXTERNAL (pay_2) + 1 MISSING_INTERNAL (mov_3).
    expect(itens).toHaveLength(3);
  });

  it('extrato e lado interno vazios devolvem lista vazia', () => {
    expect(conciliar([], [])).toHaveLength(0);
  });

  it('cada item traz acao recomendada em pt-BR', () => {
    const itens = conciliar([PAGAMENTO_INTERNO], []);

    expect(itens[0]?.recommendedAction).toContain('provedor');
    expect(itens[0]?.recommendedAction.length).toBeGreaterThan(20);
  });
});

describe('contarEmAberto', () => {
  it('MATCHED nao conta como pendencia', () => {
    const itens = conciliar([PAGAMENTO_INTERNO], [PAGAMENTO_EXTERNO]);

    expect(contarEmAberto(itens)).toBe(0);
  });

  it('conta divergencia dos dois lados', () => {
    const itens = conciliar(
      [PAGAMENTO_INTERNO],
      [{ ...PAGAMENTO_EXTERNO, externalMovementId: 'mov_9', externalPaymentId: 'fake_pay_9' }],
    );

    expect(contarEmAberto(itens)).toBe(2);
  });
});
