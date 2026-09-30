import { describe, expect, it } from '@jest/globals';

import { JANELA_AO_VIVO_MS, ehPassagemAoVivo } from './passagem-ao-vivo.js';

/**
 * #476 -- Arena Positiva, 30/09/2026. Ao reconectar, o leitor mandou num
 * `sendlog` passagens de horas atras. Tratadas como ao vivo, virariam giro de
 * catraca sem ninguem na frente assim que a catraca obedecer o ArenaHub.
 */
describe('ehPassagemAoVivo', () => {
  const agora = new Date('2026-09-30T19:18:28.000Z');

  it('e ao vivo quando o leitor acabou de reconhecer', () => {
    expect(ehPassagemAoVivo(new Date(agora.getTime() - 1_000), agora)).toBe(true);
  });

  it('NAO e ao vivo quando o registro e mais velho que a janela', () => {
    expect(ehPassagemAoVivo(new Date(agora.getTime() - JANELA_AO_VIVO_MS - 1), agora)).toBe(false);
  });

  it('NAO e ao vivo quando o horario do leitor e ilegivel -- duvida nao gira catraca', () => {
    expect(ehPassagemAoVivo(new Date(Number.NaN), agora)).toBe(false);
  });

  it('e ao vivo quando o relogio do leitor esta adiantado -- o evento acabou de chegar', () => {
    expect(ehPassagemAoVivo(new Date(agora.getTime() + 90_000), agora)).toBe(true);
  });
});
