import { describe, expect, it } from '@jest/globals';

import { estaNoLimiarDeVencimento, estaAusenteHaSeteDias } from './gatilhos-de-prazo.js';

describe('estaNoLimiarDeVencimento', () => {
  it('true quando faltam exatamente 3 dias para o vencimento', () => {
    const agora = new Date('2026-09-16T00:00:00Z');
    const dueAt = new Date('2026-09-19T00:00:00Z');

    expect(estaNoLimiarDeVencimento(dueAt, agora, 3)).toBe(true);
  });

  it('false quando faltam 2 dias', () => {
    const agora = new Date('2026-09-16T00:00:00Z');
    const dueAt = new Date('2026-09-18T00:00:00Z');

    expect(estaNoLimiarDeVencimento(dueAt, agora, 3)).toBe(false);
  });

  it('false quando faltam 4 dias', () => {
    const agora = new Date('2026-09-16T00:00:00Z');
    const dueAt = new Date('2026-09-20T00:00:00Z');

    expect(estaNoLimiarDeVencimento(dueAt, agora, 3)).toBe(false);
  });
});

describe('estaAusenteHaSeteDias', () => {
  it('false com check-in ha 6 dias', () => {
    const agora = new Date('2026-09-16T12:00:00Z');
    const ultimoCheckIn = new Date('2026-09-10T12:00:00Z');

    expect(estaAusenteHaSeteDias(ultimoCheckIn, agora)).toBe(false);
  });

  it('true com check-in ha exatamente 7 dias', () => {
    const agora = new Date('2026-09-16T12:00:00Z');
    const ultimoCheckIn = new Date('2026-09-09T12:00:00Z');

    expect(estaAusenteHaSeteDias(ultimoCheckIn, agora)).toBe(true);
  });

  it('true com check-in ha mais de 7 dias', () => {
    const agora = new Date('2026-09-16T12:00:00Z');
    const ultimoCheckIn = new Date('2026-08-01T12:00:00Z');

    expect(estaAusenteHaSeteDias(ultimoCheckIn, agora)).toBe(true);
  });
});
