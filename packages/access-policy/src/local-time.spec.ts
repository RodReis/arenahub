import { describe, expect, it } from '@jest/globals';

import { resolverHoraLocal } from './local-time.js';

/**
 * O ponto onde tzdata entra no sistema.
 *
 * Estes testes usam fusos com comportamentos DIFERENTES de proposito:
 * Sao Paulo (sem horario de verao desde 2019, offset -3 fixo), Nova York
 * (com DST ativo) e UTC. Se alguem trocar `Intl` por aritmetica de offset,
 * o caso de Nova York quebra -- que e exatamente o alarme que se quer.
 */

const SP = 'America/Sao_Paulo';

describe('resolverHoraLocal', () => {
  it('converte UTC para a hora local de Sao Paulo', () => {
    // 17:00Z = 14:00 em SP (-3). Quarta-feira.
    expect(resolverHoraLocal('2026-08-12T17:00:00.000Z', SP)).toEqual({
      dayOfWeek: 3,
      minuteOfDay: 14 * 60,
    });
  });

  it('vira o dia da semana para tras quando a hora local ainda e do dia anterior', () => {
    // 02:00Z de quinta = 23:00 de quarta em SP.
    expect(resolverHoraLocal('2026-08-13T02:00:00.000Z', SP)).toEqual({
      dayOfWeek: 3,
      minuteOfDay: 23 * 60,
    });
  });

  it('devolve 0 na meia-noite local, nunca 1440', () => {
    // 03:00Z = 00:00 em SP.
    expect(resolverHoraLocal('2026-08-12T03:00:00.000Z', SP)).toEqual({
      dayOfWeek: 3,
      minuteOfDay: 0,
    });
  });

  it('aceita Date alem de string', () => {
    expect(resolverHoraLocal(new Date('2026-08-12T17:00:00.000Z'), SP)).toEqual({
      dayOfWeek: 3,
      minuteOfDay: 14 * 60,
    });
  });

  it('em UTC nao desloca nada', () => {
    expect(resolverHoraLocal('2026-08-12T17:30:00.000Z', 'UTC')).toEqual({
      dayOfWeek: 3,
      minuteOfDay: 17 * 60 + 30,
    });
  });

  it('respeita horario de verao onde ele existe -- Nova York em julho e -4', () => {
    // Sem DST seria 12:00; com DST e 13:00. Aritmetica de offset fixo erra aqui.
    expect(resolverHoraLocal('2026-07-15T17:00:00.000Z', 'America/New_York')).toEqual({
      dayOfWeek: 3,
      minuteOfDay: 13 * 60,
    });
  });

  it('respeita a ausencia de DST em janeiro no mesmo fuso -- Nova York e -5', () => {
    expect(resolverHoraLocal('2026-01-14T17:00:00.000Z', 'America/New_York')).toEqual({
      dayOfWeek: 3,
      minuteOfDay: 12 * 60,
    });
  });

  it('falha alto em fuso desconhecido em vez de cair para UTC', () => {
    expect(() => resolverHoraLocal('2026-08-12T17:00:00.000Z', 'Marte/Olympus')).toThrow();
  });

  it('falha alto em instante invalido', () => {
    expect(() => resolverHoraLocal('nao-e-data', SP)).toThrow(RangeError);
  });
});
