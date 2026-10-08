import { describe, expect, it } from '@jest/globals';

import {
  CONFIGURACAO_DE_PAGAMENTO_PADRAO,
  ConfiguracaoDePagamentoInvalidaError,
  ehDiaDeGerar,
  validarConfiguracaoDePagamento,
} from './configuracao-de-pagamento.js';

const ok = { invoiceGenerationDay: 1, dueDay: 10, graceDays: 5 };

describe('validarConfiguracaoDePagamento', () => {
  it('o padrao e o do job atual: gerar 1, vencer 10, bloquear 5', () => {
    expect(CONFIGURACAO_DE_PAGAMENTO_PADRAO).toEqual(ok);
    expect(validarConfiguracaoDePagamento(ok)).toEqual(ok);
  });

  it('aceita os limites exatos (gerar 28 / vencer 28 / bloqueio 1 e 30)', () => {
    expect(() => validarConfiguracaoDePagamento({ invoiceGenerationDay: 28, dueDay: 28, graceDays: 1 })).not.toThrow();
    expect(() => validarConfiguracaoDePagamento({ invoiceGenerationDay: 1, dueDay: 28, graceDays: 30 })).not.toThrow();
  });

  it.each([
    [{ ...ok, invoiceGenerationDay: 0 }],
    [{ ...ok, invoiceGenerationDay: 29, dueDay: 28 }],
    [{ ...ok, dueDay: 0 }],
    [{ ...ok, dueDay: 29 }],
    [{ ...ok, graceDays: 0 }],
    [{ ...ok, graceDays: 31 }],
    [{ ...ok, invoiceGenerationDay: 15, dueDay: 10 }],
    [{ ...ok, dueDay: 10.5 }],
    [{ ...ok, graceDays: Number.NaN }],
  ])('recusa %j com BILLING_SETTINGS_INVALID', (entrada) => {
    expect(() => validarConfiguracaoDePagamento(entrada)).toThrow(ConfiguracaoDePagamentoInvalidaError);
  });
});

describe('ehDiaDeGerar', () => {
  it('compara o dia do mes em Brasilia, nao em UTC', () => {
    // 01/11 02:30Z ainda e 31/10 23:30 em Sao Paulo (UTC-3)
    expect(ehDiaDeGerar(new Date('2026-11-01T02:30:00Z'), 1)).toBe(false);
    expect(ehDiaDeGerar(new Date('2026-11-01T03:05:00Z'), 1)).toBe(true);
  });

  it('dia 28 em fevereiro de ano comum existe e bate', () => {
    expect(ehDiaDeGerar(new Date('2027-02-28T12:00:00Z'), 28)).toBe(true);
    expect(ehDiaDeGerar(new Date('2027-02-27T12:00:00Z'), 28)).toBe(false);
  });
});
