import { describe, expect, it } from '@jest/globals';

import { sessaoPodeConfirmar, type ArquivoDaSessao } from './sessao-de-revisao.js';
import type { LinhaConsolidada } from './consolidacao-de-laudos.js';

const bio: ArquivoDaSessao = { importId: 'i1', sourceLabel: 'CF610_G', tipoDeLaudo: 'BIOIMPEDANCE' };
const ecg: ArquivoDaSessao = { importId: 'i2', sourceLabel: 'ECG 30s', tipoDeLaudo: 'ECG' };

const linhaResolvida: LinhaConsolidada = {
  type: 'WEIGHT', campos: [{ state: 'CONFIRMED' } as never], concordante: true, origens: ['CF610_G'],
};

describe('quando a sessao pode virar avaliacao', () => {
  it('aceita bioimpedancia sozinha -- o ECG e opcional', () => {
    expect(sessaoPodeConfirmar([bio], [linhaResolvida])).toEqual({ pronta: true });
  });

  it('recusa sessao so com ECG', () => {
    expect(sessaoPodeConfirmar([ecg], [linhaResolvida])).toEqual({
      pronta: false, motivo: 'BIOIMPEDANCE_REQUIRED',
    });
  });

  it('recusa sessao vazia', () => {
    expect(sessaoPodeConfirmar([], [])).toEqual({ pronta: false, motivo: 'SESSION_EMPTY' });
  });

  it('recusa enquanto houver divergencia sem escolha do humano', () => {
    const divergente: LinhaConsolidada = {
      type: 'WEIGHT',
      campos: [{ state: 'PENDING' } as never, { state: 'PENDING' } as never],
      concordante: false,
      origens: ['CF610_G', 'Unique Health'],
    };

    expect(sessaoPodeConfirmar([bio], [divergente])).toEqual({
      pronta: false, motivo: 'DIVERGENCE_UNRESOLVED',
    });
  });

  it('aceita divergencia JA resolvida pelo humano', () => {
    const resolvida: LinhaConsolidada = {
      type: 'WEIGHT',
      campos: [{ state: 'CONFIRMED' } as never, { state: 'DISCARDED' } as never],
      concordante: false,
      origens: ['CF610_G', 'Unique Health'],
    };

    expect(sessaoPodeConfirmar([bio], [resolvida])).toEqual({ pronta: true });
  });

  it('recusa divergencia quando so um lado foi decidido -- o outro ainda esta PENDING', () => {
    const parcial: LinhaConsolidada = {
      type: 'WEIGHT',
      campos: [{ state: 'CONFIRMED' } as never, { state: 'PENDING' } as never],
      concordante: false,
      origens: ['CF610_G', 'Unique Health'],
    };

    expect(sessaoPodeConfirmar([bio], [parcial])).toEqual({
      pronta: false, motivo: 'DIVERGENCE_UNRESOLVED',
    });
  });
});
