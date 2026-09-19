import { describe, expect, it } from '@jest/globals';

import { competenciaMensalDe, limiteDeConvidadosExcedido } from './guest-pass.js';

describe('competenciaMensalDe', () => {
  it('reduz o instante ao primeiro dia do mes, hora zero, em UTC', () => {
    const instante = new Date('2026-09-18T23:59:59.000Z');

    expect(competenciaMensalDe(instante).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('vira o mes no primeiro instante do mes seguinte', () => {
    const instante = new Date('2026-10-01T00:00:00.000Z');

    expect(competenciaMensalDe(instante).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('limiteDeConvidadosExcedido', () => {
  it('nao excede quando usos ficam abaixo do limite', () => {
    expect(limiteDeConvidadosExcedido(1, 2)).toBe(false);
  });

  it('excede quando usos ja alcancaram o limite', () => {
    expect(limiteDeConvidadosExcedido(2, 2)).toBe(true);
  });

  it('excede quando usos ultrapassam o limite', () => {
    expect(limiteDeConvidadosExcedido(3, 2)).toBe(true);
  });
});
