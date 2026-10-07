import { describe, expect, it } from '@jest/globals';

import { diaDeAcessoDaDiaria, fimDaDiaria, haJanelaAteOFimDoDia } from './diaria.js';
import type { JanelaDeAcesso } from './plan.js';

const SP = 'America/Sao_Paulo';
const UNIDADE = 'unidade-1';

describe('diaDeAcessoDaDiaria', () => {
  it('e o dia LOCAL da compra, como data em meia-noite UTC (convencao do dueAt)', () => {
    // sabado 10/10 12:00 em Sao Paulo
    expect(diaDeAcessoDaDiaria(new Date('2026-10-10T15:00:00.000Z'), SP).toISOString()).toBe(
      '2026-10-10T00:00:00.000Z',
    );
  });

  it('23:30 locais ainda e o dia local, embora ja seja o dia seguinte em UTC', () => {
    // sabado 23:30 em Sao Paulo = domingo 02:30Z
    expect(diaDeAcessoDaDiaria(new Date('2026-10-11T02:30:00.000Z'), SP).toISOString()).toBe(
      '2026-10-10T00:00:00.000Z',
    );
  });

  it('00:00 local ja e o dia seguinte', () => {
    expect(diaDeAcessoDaDiaria(new Date('2026-10-11T03:00:00.000Z'), SP).toISOString()).toBe(
      '2026-10-11T00:00:00.000Z',
    );
  });
});

describe('fimDaDiaria', () => {
  it('e a meia-noite local do dia seguinte', () => {
    // quarta 12:00 em Sao Paulo
    expect(fimDaDiaria(new Date('2026-10-07T15:00:00.000Z'), SP).toISOString()).toBe(
      '2026-10-08T03:00:00.000Z',
    );
  });

  it('as 23:59 locais ainda e a mesma meia-noite', () => {
    // quarta 23:59 em Sao Paulo = quinta 02:59Z
    expect(fimDaDiaria(new Date('2026-10-08T02:59:00.000Z'), SP).toISOString()).toBe(
      '2026-10-08T03:00:00.000Z',
    );
  });

  it('a 00:00 local ja e o dia seguinte', () => {
    // quinta 00:00 em Sao Paulo = quinta 03:00Z
    expect(fimDaDiaria(new Date('2026-10-08T03:00:00.000Z'), SP).toISOString()).toBe(
      '2026-10-09T03:00:00.000Z',
    );
  });

  it('respeita o fuso da unidade, e nao o UTC', () => {
    // 01:00Z de quinta ainda e QUARTA 22:00 em Sao Paulo, mas ja e 01:00 de quinta em UTC
    expect(fimDaDiaria(new Date('2026-10-08T01:00:00.000Z'), SP).toISOString()).toBe(
      '2026-10-08T03:00:00.000Z',
    );
    // Africa/Abidjan e UTC+0 o ano todo; `inicioDoDiaLocal` nao aceita o apelido 'UTC'.
    expect(fimDaDiaria(new Date('2026-10-08T01:00:00.000Z'), 'Africa/Abidjan').toISOString()).toBe(
      '2026-10-09T00:00:00.000Z',
    );
  });

  it('recusa fuso desconhecido em vez de cair em UTC (ADR-019)', () => {
    expect(() => fimDaDiaria(new Date('2026-10-07T15:00:00.000Z'), 'Marte/Olimpo')).toThrow(
      RangeError,
    );
  });
});

describe('haJanelaAteOFimDoDia', () => {
  // segunda a sexta, 06:00-22:00
  const SEG_A_SEX: JanelaDeAcesso[] = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    gymUnitId: UNIDADE,
    dayOfWeek,
    startMinute: 360,
    endMinute: 1320,
  }));

  it('quarta ao meio-dia: ha janela', () => {
    expect(haJanelaAteOFimDoDia(new Date('2026-10-07T15:00:00.000Z'), SP, UNIDADE, SEG_A_SEX)).toBe(
      true,
    );
  });

  it('domingo: nao ha janela', () => {
    expect(haJanelaAteOFimDoDia(new Date('2026-10-11T15:00:00.000Z'), SP, UNIDADE, SEG_A_SEX)).toBe(
      false,
    );
  });

  it('quarta 21:59 ainda ha janela; 22:00 nao (fim exclusivo)', () => {
    expect(haJanelaAteOFimDoDia(new Date('2026-10-08T00:59:00.000Z'), SP, UNIDADE, SEG_A_SEX)).toBe(
      true,
    );
    expect(haJanelaAteOFimDoDia(new Date('2026-10-08T01:00:00.000Z'), SP, UNIDADE, SEG_A_SEX)).toBe(
      false,
    );
  });

  it('antes da abertura ainda ha janela hoje', () => {
    // quarta 05:00 em Sao Paulo
    expect(haJanelaAteOFimDoDia(new Date('2026-10-07T08:00:00.000Z'), SP, UNIDADE, SEG_A_SEX)).toBe(
      true,
    );
  });

  it('ignora janela de OUTRA unidade', () => {
    expect(
      haJanelaAteOFimDoDia(new Date('2026-10-07T15:00:00.000Z'), SP, 'outra-unidade', SEG_A_SEX),
    ).toBe(false);
  });

  it('plano sem janela nenhuma: nao ha', () => {
    expect(haJanelaAteOFimDoDia(new Date('2026-10-07T15:00:00.000Z'), SP, UNIDADE, [])).toBe(false);
  });
});
