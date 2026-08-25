import { describe, expect, it } from '@jest/globals';

import { calcularExpiracao, estender } from './sessao.js';

/** Funcao pura: o "agora" entra por parametro, nunca do relogio. */
describe('sessao do totem', () => {
  const INICIO = new Date('2026-08-25T10:00:00.000Z');

  it('expira em 60 s por padrao', () => {
    expect(calcularExpiracao(INICIO, 60)).toEqual(new Date('2026-08-25T10:01:00.000Z'));
  });

  it('estender soma 30 s ao que resta', () => {
    const agora = new Date('2026-08-25T10:00:40.000Z');
    const expiraEm = new Date('2026-08-25T10:01:00.000Z');

    // Restam 20 s; +30 = 50 s a partir de agora.
    expect(estender(expiraEm, agora, 30, 99)).toEqual(new Date('2026-08-25T10:01:30.000Z'));
  });

  it('estender respeita o teto de 99 s a partir de agora', () => {
    const agora = new Date('2026-08-25T10:00:00.000Z');
    const expiraEm = new Date('2026-08-25T10:01:30.000Z');

    // Restam 90 s; +30 daria 120, mas o teto e 99.
    expect(estender(expiraEm, agora, 30, 99)).toEqual(new Date('2026-08-25T10:01:39.000Z'));
  });

  it('estender sessao ja vencida nao ressuscita para o passado', () => {
    const agora = new Date('2026-08-25T10:02:00.000Z');
    const expiraEm = new Date('2026-08-25T10:01:00.000Z');

    expect(estender(expiraEm, agora, 30, 99).getTime()).toBeGreaterThan(agora.getTime());
  });
});
