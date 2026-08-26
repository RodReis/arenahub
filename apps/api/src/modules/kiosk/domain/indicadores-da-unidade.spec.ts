import { describe, expect, it } from '@jest/globals';

import {
  JANELA_DE_TREINO_HORAS,
  inicioDaJanelaDeTreino,
  inicioDoDiaLocal,
} from './indicadores-da-unidade.js';

describe('inicioDoDiaLocal -- o dia da academia, nao o dia UTC', () => {
  it('meio-dia local devolve a meia-noite local do mesmo dia', () => {
    // 15:00 UTC = 12:00 em -03:00.
    expect(inicioDoDiaLocal(new Date('2026-08-26T15:00:00.000Z')).toISOString()).toBe(
      '2026-08-26T03:00:00.000Z',
    );
  });

  it('22h locais AINDA sao o mesmo dia, embora ja seja o dia seguinte em UTC', () => {
    // 01:00 UTC do dia 27 = 22:00 do dia 26 em -03:00. Usar o dia UTC aqui
    // zeraria o contador do totem as 21h, com a academia cheia.
    expect(inicioDoDiaLocal(new Date('2026-08-27T01:00:00.000Z')).toISOString()).toBe(
      '2026-08-26T03:00:00.000Z',
    );
  });

  it('00:30 local ja pertence ao dia novo', () => {
    expect(inicioDoDiaLocal(new Date('2026-08-27T03:30:00.000Z')).toISOString()).toBe(
      '2026-08-27T03:00:00.000Z',
    );
  });

  it('exatamente a meia-noite local, o dia comeca ali mesmo', () => {
    const meiaNoite = new Date('2026-08-27T03:00:00.000Z');

    expect(inicioDoDiaLocal(meiaNoite).toISOString()).toBe(meiaNoite.toISOString());
  });
});

describe('inicioDaJanelaDeTreino', () => {
  it('recua a janela configurada a partir do agora', () => {
    const agora = new Date('2026-08-26T18:00:00.000Z');

    expect(inicioDaJanelaDeTreino(agora).toISOString()).toBe('2026-08-26T15:00:00.000Z');
    expect(JANELA_DE_TREINO_HORAS).toBe(3);
  });

  it('atravessa a virada do dia sem cortar em zero', () => {
    // 01:00 UTC menos 3h cai no dia anterior -- quem entrou as 23h ainda
    // treina. Prender a janela ao inicio do dia perderia essa pessoa.
    expect(inicioDaJanelaDeTreino(new Date('2026-08-27T01:00:00.000Z')).toISOString()).toBe(
      '2026-08-26T22:00:00.000Z',
    );
  });
});
