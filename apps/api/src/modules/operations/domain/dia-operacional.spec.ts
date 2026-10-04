import { describe, expect, it } from '@jest/globals';

import { inicioDoDiaOperacional } from './dia-operacional.js';

const SP = 'America/Sao_Paulo';

describe('inicioDoDiaOperacional -- o dia vira às 23h da unidade, não à meia-noite UTC', () => {
  it('durante o dia, o corte é às 23h de ontem', () => {
    // 10h em SP (13h UTC) de 04/10 -> 23h de 03/10 em SP = 02h UTC de 04/10.
    expect(inicioDoDiaOperacional(new Date('2026-10-04T13:00:00.000Z'), SP).toISOString()).toBe(
      '2026-10-04T02:00:00.000Z',
    );
  });

  /** O defeito antigo: às 21h30 de SP já era "amanhã" em UTC e a taxa zerava. */
  it('às 21h30 a taxa ainda é do mesmo dia', () => {
    expect(inicioDoDiaOperacional(new Date('2026-10-05T00:30:00.000Z'), SP).toISOString()).toBe(
      '2026-10-04T02:00:00.000Z',
    );
  });

  it('às 22h59 ainda é o mesmo dia; às 23h00 vira', () => {
    expect(inicioDoDiaOperacional(new Date('2026-10-05T01:59:00.000Z'), SP).toISOString()).toBe(
      '2026-10-04T02:00:00.000Z',
    );
    expect(inicioDoDiaOperacional(new Date('2026-10-05T02:00:00.000Z'), SP).toISOString()).toBe(
      '2026-10-05T02:00:00.000Z',
    );
  });

  it('depois da virada, à meia-noite local, o corte continua nas 23h de ontem', () => {
    expect(inicioDoDiaOperacional(new Date('2026-10-05T03:30:00.000Z'), SP).toISOString()).toBe(
      '2026-10-05T02:00:00.000Z',
    );
  });

  it('nunca devolve um instante no futuro', () => {
    for (let minuto = 0; minuto < 1440; minuto += 7) {
      const agora = new Date(Date.UTC(2026, 9, 4, 0, minuto));

      expect(inicioDoDiaOperacional(agora, SP).getTime()).toBeLessThanOrEqual(agora.getTime());
      expect(agora.getTime() - inicioDoDiaOperacional(agora, SP).getTime()).toBeLessThan(86_400_000);
    }
  });

  it('respeita o fuso da unidade', () => {
    // Manaus é UTC-4: 23h locais = 03h UTC.
    expect(
      inicioDoDiaOperacional(new Date('2026-10-04T13:00:00.000Z'), 'America/Manaus').toISOString(),
    ).toBe('2026-10-04T03:00:00.000Z');
  });

  it('fuso inválido lança, sem cair em UTC', () => {
    expect(() => inicioDoDiaOperacional(new Date(), 'Fuso/Inventado')).toThrow();
  });
});
