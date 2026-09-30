import { describe, expect, it } from 'vitest';

import { competenciasParaAdiantar } from './adiantamento';

describe('competenciasParaAdiantar', () => {
  it('com 1 mes, devolve so o mes de agora normalizado ao dia 1', () => {
    const agora = new Date('2026-09-15T14:30:00Z');

    expect(competenciasParaAdiantar(agora, 1)).toEqual([new Date('2026-09-01T00:00:00Z')]);
  });

  it('com 3 meses, devolve os 3 meses consecutivos a partir de agora, sem pular nenhum', () => {
    const agora = new Date('2026-09-15T00:00:00Z');

    expect(competenciasParaAdiantar(agora, 3)).toEqual([
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-11-01T00:00:00Z'),
    ]);
  });

  it('atravessa a virada de ano sem pular dezembro nem duplicar janeiro', () => {
    const agora = new Date('2026-11-20T00:00:00Z');

    expect(competenciasParaAdiantar(agora, 3)).toEqual([
      new Date('2026-11-01T00:00:00Z'),
      new Date('2026-12-01T00:00:00Z'),
      new Date('2027-01-01T00:00:00Z'),
    ]);
  });

  it('recusa zero e negativo -- nao ha o que gerar', () => {
    expect(() => competenciasParaAdiantar(new Date(), 0)).toThrow('quantidade de meses deve ser pelo menos 1');
    expect(() => competenciasParaAdiantar(new Date(), -1)).toThrow('quantidade de meses deve ser pelo menos 1');
  });

  it('recusa mais que 12 meses -- adiantamento nao e o mesmo que assinatura anual', () => {
    expect(() => competenciasParaAdiantar(new Date(), 13)).toThrow('no maximo 12 meses de cada vez');
  });

  it('recusa fracionado -- nao ha meio mes de cobranca', () => {
    expect(() => competenciasParaAdiantar(new Date(), 1.5)).toThrow('quantidade de meses deve ser um numero inteiro');
  });
});
