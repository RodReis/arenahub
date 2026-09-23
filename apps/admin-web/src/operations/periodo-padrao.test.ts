import { describe, expect, it } from 'vitest';

import { periodoPadraoDeEventos } from './periodo-padrao';

describe('periodoPadraoDeEventos', () => {
  it('as ultimas 24h, no formato que datetime-local aceita', () => {
    const agora = new Date('2026-09-23T18:00:00.000Z');

    const periodo = periodoPadraoDeEventos(agora, 'America/Sao_Paulo');

    // 18h UTC = 15h em Sao Paulo (UTC-3); 24h antes = 15h do dia anterior.
    expect(periodo.de).toBe('2026-09-22T15:00');
    expect(periodo.ate).toBe('2026-09-23T15:00');
  });

  /*
   * A VIRADA DE DIA CIVIL: 00h30 em Sao Paulo e 03h30 UTC. Se o calculo
   * usasse o dia UTC em vez do dia do fuso, o "ate" apontaria para o dia
   * errado -- o defeito classico de misturar civil com UTC.
   */
  it('atravessa a meia-noite no fuso da academia corretamente', () => {
    const agora = new Date('2026-09-23T03:30:00.000Z');

    const periodo = periodoPadraoDeEventos(agora, 'America/Sao_Paulo');

    // 03h30 UTC = 00h30 em Sao Paulo, ainda 22/09 no fuso local.
    expect(periodo.ate).toBe('2026-09-23T00:30');
    expect(periodo.de).toBe('2026-09-22T00:30');
  });

  it('fuso diferente produz horario diferente para o MESMO instante', () => {
    const agora = new Date('2026-09-23T18:00:00.000Z');

    const emSaoPaulo = periodoPadraoDeEventos(agora, 'America/Sao_Paulo');
    const emManaus = periodoPadraoDeEventos(agora, 'America/Manaus');

    // Manaus e UTC-4, uma hora atras de Sao Paulo -- o mesmo instante real
    // aparece com hora civil diferente conforme o fuso pedido.
    expect(emSaoPaulo.ate).not.toBe(emManaus.ate);
  });

  it('fuso invalido lanca em vez de devolver data incorreta', () => {
    expect(() => periodoPadraoDeEventos(new Date(), 'Fuso/Que/Nao/Existe')).toThrow();
  });
});
