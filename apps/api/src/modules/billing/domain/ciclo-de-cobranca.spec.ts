import { describe, expect, it } from '@jest/globals';

import {
  CicloInvalidoError,
  competenciaDe,
  inicioDoProximoCiclo,
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

describe('instanteDeBloqueio (F88: meia-noite LOCAL de vencimento + carencia)', () => {
  const SP = 'America/Sao_Paulo';

  it('vence 10/10 (data em meia-noite UTC), carencia 5, Sao Paulo: bloqueia 15/10 00:00 BRT', () => {
    expect(instanteDeBloqueio(new Date('2026-10-10T00:00:00Z'), 5, SP)).toEqual(new Date('2026-10-15T03:00:00Z'));
  });

  it('carencia zero bloqueia no primeiro instante LOCAL do dia do vencimento', () => {
    expect(instanteDeBloqueio(new Date('2026-10-10T00:00:00Z'), 0, SP)).toEqual(new Date('2026-10-10T03:00:00Z'));
  });

  it('atravessa o fim do mes', () => {
    expect(instanteDeBloqueio(new Date('2026-10-30T00:00:00Z'), 5, SP)).toEqual(new Date('2026-11-04T03:00:00Z'));
  });

  it('recusa carencia negativa', () => {
    expect(() => instanteDeBloqueio(new Date('2026-10-10T00:00:00Z'), -1, SP)).toThrow(CicloInvalidoError);
  });
});

describe('inicioDoProximoCiclo', () => {
  it('devolve o dia 1 do mes seguinte, a meia-noite UTC', () => {
    expect(inicioDoProximoCiclo(new Date('2026-08-18T13:45:00Z'))).toEqual(new Date('2026-09-01T00:00:00Z'));
  });

  it('no primeiro dia do mes ainda aponta para o mes seguinte, nunca para hoje', () => {
    expect(inicioDoProximoCiclo(new Date('2026-08-01T00:00:00Z'))).toEqual(new Date('2026-09-01T00:00:00Z'));
  });

  it('vira o ano em dezembro', () => {
    expect(inicioDoProximoCiclo(new Date('2026-12-31T23:59:59Z'))).toEqual(new Date('2027-01-01T00:00:00Z'));
  });
});
