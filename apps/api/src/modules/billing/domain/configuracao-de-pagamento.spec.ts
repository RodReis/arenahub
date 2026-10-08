import { describe, expect, it } from '@jest/globals';

import {
  CONFIGURACAO_DE_PAGAMENTO_PADRAO,
  ConfiguracaoDePagamentoInvalidaError,
  jaChegouODiaDeGerar,
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

describe('jaChegouODiaDeGerar', () => {
  it('antes do dia nao chegou; no dia e depois dele, chegou', () => {
    const hoje = new Date('2026-11-10T12:00:00Z');

    expect(jaChegouODiaDeGerar(hoje, 11)).toBe(false);
    expect(jaChegouODiaDeGerar(hoje, 10)).toBe(true);
    expect(jaChegouODiaDeGerar(hoje, 5)).toBe(true);
  });

  it('compara o dia do mes em Brasilia, nao em UTC', () => {
    // 05/11 03:05Z = 00:05 em Sao Paulo (UTC-3): o cron dispara aqui
    expect(jaChegouODiaDeGerar(new Date('2026-11-05T03:05:00Z'), 5)).toBe(true);
    expect(jaChegouODiaDeGerar(new Date('2026-11-05T03:05:00Z'), 6)).toBe(false);
    // 04/11 02:59Z ainda e 03/11 23:59 em Sao Paulo
    expect(jaChegouODiaDeGerar(new Date('2026-11-04T02:59:00Z'), 4)).toBe(false);
    expect(jaChegouODiaDeGerar(new Date('2026-11-04T02:59:00Z'), 3)).toBe(true);
  });

  it('dia 28 (o maximo) em fevereiro de ano comum existe e bate', () => {
    expect(jaChegouODiaDeGerar(new Date('2027-02-28T12:00:00Z'), 28)).toBe(true);
    expect(jaChegouODiaDeGerar(new Date('2027-02-27T12:00:00Z'), 28)).toBe(false);
  });
});
