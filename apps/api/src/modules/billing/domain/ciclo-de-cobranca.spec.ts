import { describe, expect, it } from '@jest/globals';

import {
  CicloInvalidoError,
  competenciaDe,
  proximoVencimento,
  instanteDeBloqueio,
} from './ciclo-de-cobranca.js';

/**
 * Ciclo de cobranca: de que periodo e a invoice e quando ela vence.
 *
 * Funcoes puras -- o "agora" e o timezone entram por parametro
 * (`CLAUDE.md`). Data de vencimento errada por fuso e o bug classico de
 * cobranca: bloqueia o aluno um dia antes na virada do mes.
 */
describe('competenciaDe', () => {
  it('normaliza para o primeiro dia do mes', () => {
    expect(competenciaDe(new Date('2026-08-18T13:45:00Z'))).toEqual(new Date('2026-08-01T00:00:00Z'));
  });

  it('primeiro dia continua o primeiro dia', () => {
    expect(competenciaDe(new Date('2026-08-01T00:00:00Z'))).toEqual(new Date('2026-08-01T00:00:00Z'));
  });

  it('ultimo instante do mes ainda e do mes', () => {
    expect(competenciaDe(new Date('2026-08-31T23:59:59Z'))).toEqual(new Date('2026-08-01T00:00:00Z'));
  });
});

describe('proximoVencimento', () => {
  it('dia 10 da competencia de agosto vence em 10/08', () => {
    expect(proximoVencimento(new Date('2026-08-01T00:00:00Z'), 10)).toEqual(
      new Date('2026-08-10T00:00:00Z'),
    );
  });

  it('dia 28 existe em fevereiro', () => {
    expect(proximoVencimento(new Date('2026-02-01T00:00:00Z'), 28)).toEqual(
      new Date('2026-02-28T00:00:00Z'),
    );
  });

  it('rejeita dia fora de 1..28 -- 29, 30 e 31 nao existem em todo mes', () => {
    expect(() => proximoVencimento(new Date('2026-08-01T00:00:00Z'), 31)).toThrow(
      CicloInvalidoError,
    );
    expect(() => proximoVencimento(new Date('2026-08-01T00:00:00Z'), 0)).toThrow(CicloInvalidoError);
  });
});

/**
 * ADR-019 / INV-144: o bloqueio e no PRIMEIRO INSTANTE depois de
 * `vencimento + carencia`. Nao no fim do dia, nao arredondado, e sem
 * adiamento por feriado.
 */
describe('instanteDeBloqueio', () => {
  it('soma a carencia em dias ao vencimento', () => {
    expect(instanteDeBloqueio(new Date('2026-08-10T00:00:00Z'), 5)).toEqual(
      new Date('2026-08-15T00:00:00Z'),
    );
  });

  it('carencia zero bloqueia no proprio vencimento', () => {
    expect(instanteDeBloqueio(new Date('2026-08-10T00:00:00Z'), 0)).toEqual(
      new Date('2026-08-10T00:00:00Z'),
    );
  });

  it('rejeita carencia negativa', () => {
    expect(() => instanteDeBloqueio(new Date('2026-08-10T00:00:00Z'), -1)).toThrow(
      CicloInvalidoError,
    );
  });
});
