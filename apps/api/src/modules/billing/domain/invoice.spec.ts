import { describe, expect, it } from '@jest/globals';

import {
  InvoiceInvalidaError,
  abrirInvoice,
  aplicarPagamento,
  calcularTotais,
  podeTransicionar,
} from './invoice.js';

/**
 * Ciclo da invoice. `CONVENTION.md` 3.4 deixou dois pontos `[indefinido]`:
 * o gatilho de `DRAFT -> OPEN` e as condicoes de `CANCELLED`. Ambos sao
 * reversiveis, entao decido aqui e registro no PR (`CLAUDE.md`, processo de
 * 18/08/2026):
 *
 * - `DRAFT -> OPEN` acontece quando a invoice ganha ao menos um item e um
 *   vencimento. Invoice sem item nao tem o que cobrar.
 * - `CANCELLED` so a partir de `DRAFT` ou `OPEN`, e nunca depois de paga --
 *   invoice paga que precisa voltar atras e estorno, que tem estado proprio
 *   (INV-069).
 */
describe('calcularTotais', () => {
  it('subtotal e a soma dos itens; total desconta', () => {
    const totais = calcularTotais(
      [
        { quantity: 1, unitAmountMinor: 15000 },
        { quantity: 1, unitAmountMinor: 3000 },
      ],
      1000,
    );
    expect(totais).toEqual({ subtotalMinor: 18000, discountMinor: 1000, totalMinor: 17000 });
  });

  it('sem desconto o total e o subtotal', () => {
    expect(calcularTotais([{ quantity: 1, unitAmountMinor: 20000 }], 0).totalMinor).toBe(20000);
  });

  it('desconto maior que o subtotal e rejeitado -- invoice nao fica negativa', () => {
    expect(() => calcularTotais([{ quantity: 1, unitAmountMinor: 100 }], 500)).toThrow(
      InvoiceInvalidaError,
    );
  });

  it('desconto igual ao subtotal zera a invoice, e isso e valido', () => {
    expect(calcularTotais([{ quantity: 1, unitAmountMinor: 500 }], 500).totalMinor).toBe(0);
  });
});

describe('abrirInvoice', () => {
  const vencimento = new Date('2026-09-10T03:00:00Z');

  it('abre com item e vencimento', () => {
    const invoice = abrirInvoice({
      itens: [{ quantity: 1, unitAmountMinor: 15000 }],
      discountMinor: 0,
      dueAt: vencimento,
    });
    expect(invoice.status).toBe('OPEN');
    expect(invoice.totalMinor).toBe(15000);
  });

  it('recusa abrir sem item -- nao ha o que cobrar', () => {
    expect(() => abrirInvoice({ itens: [], discountMinor: 0, dueAt: vencimento })).toThrow(
      InvoiceInvalidaError,
    );
  });
});

describe('podeTransicionar', () => {
  it('OPEN vai a PAID', () => {
    expect(podeTransicionar('OPEN', 'PAID')).toBe(true);
  });

  it('OPEN vence e vira OVERDUE', () => {
    expect(podeTransicionar('OPEN', 'OVERDUE')).toBe(true);
  });

  it('OVERDUE ainda pode ser paga', () => {
    expect(podeTransicionar('OVERDUE', 'PAID')).toBe(true);
  });

  it('PAID NUNCA volta a OPEN -- INV-069', () => {
    expect(podeTransicionar('PAID', 'OPEN')).toBe(false);
    expect(podeTransicionar('PAID', 'OVERDUE')).toBe(false);
  });

  it('paga nao se cancela; o caminho de volta e estorno', () => {
    expect(podeTransicionar('PAID', 'CANCELLED')).toBe(false);
  });

  it('DRAFT e OPEN podem ser canceladas', () => {
    expect(podeTransicionar('DRAFT', 'CANCELLED')).toBe(true);
    expect(podeTransicionar('OPEN', 'CANCELLED')).toBe(true);
  });
});

/**
 * Pagamento parcial NAO existe no MVP 2 (ADR-027, resposta 1 do PI): a
 * invoice so vira `PAID` com o valor integral. Sobrepagamento e aceito e
 * vira credito (resposta 4).
 */
describe('aplicarPagamento', () => {
  it('valor integral paga a invoice', () => {
    expect(aplicarPagamento(15000, 15000)).toEqual({ status: 'PAID', creditoMinor: 0 });
  });

  it('valor a menor e REJEITADO -- nao existe saldo devedor no MVP 2', () => {
    expect(() => aplicarPagamento(15000, 11900)).toThrow(InvoiceInvalidaError);
  });

  it('sobrepagamento paga e gera credito da diferenca', () => {
    expect(aplicarPagamento(12000, 12100)).toEqual({ status: 'PAID', creditoMinor: 100 });
  });
});
