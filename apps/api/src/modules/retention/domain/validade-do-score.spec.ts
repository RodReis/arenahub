import { describe, expect, it } from '@jest/globals';

import { VALIDADE_PADRAO, validadeDoScore } from './validade-do-score.js';

const calculado = new Date('2026-09-01T06:00:00.000Z');

describe('validadeDoScore', () => {
  it('e ATUAL no mesmo dia', () => {
    expect(validadeDoScore(calculado, new Date('2026-09-01T20:00:00.000Z'))).toEqual({
      estado: 'ATUAL',
      idadeEmDias: 0,
    });
  });

  it('e ATUAL no limite do primeiro dia', () => {
    expect(validadeDoScore(calculado, new Date('2026-09-02T05:59:59.000Z')).estado).toBe('ATUAL');
  });

  it('vira DESATUALIZADO a partir de um dia inteiro', () => {
    expect(validadeDoScore(calculado, new Date('2026-09-02T06:00:00.000Z'))).toEqual({
      estado: 'DESATUALIZADO',
      idadeEmDias: 1,
    });
  });

  it('vira EXPIRADO a partir de sete dias', () => {
    expect(validadeDoScore(calculado, new Date('2026-09-08T06:00:00.000Z'))).toEqual({
      estado: 'EXPIRADO',
      idadeEmDias: 7,
    });
  });

  it('mantem a idade visivel quando expira -- M6-BR-009 sinaliza, nao silencia', () => {
    const validade = validadeDoScore(calculado, new Date('2026-10-01T06:00:00.000Z'));

    expect(validade.estado).toBe('EXPIRADO');
    expect(validade.idadeEmDias).toBe(30);
  });

  it('aceita limites configurados', () => {
    expect(
      validadeDoScore(calculado, new Date('2026-09-02T06:00:00.000Z'), {
        desatualizadoEmDias: 3,
        expiradoEmDias: 10,
      }).estado,
    ).toBe('ATUAL');
  });

  it('trata relogio para tras como idade zero, nao negativa', () => {
    expect(validadeDoScore(calculado, new Date('2026-08-30T06:00:00.000Z'))).toEqual({
      estado: 'ATUAL',
      idadeEmDias: 0,
    });
  });

  it('tem padrao de um dia para desatualizado e sete para expirado', () => {
    expect(VALIDADE_PADRAO).toEqual({ desatualizadoEmDias: 1, expiradoEmDias: 7 });
  });
});
