import { describe, expect, it } from '@jest/globals';

import { NUMERO_MAXIMO, NUMERO_MINIMO, proximoNumeroLivre } from './proximo-numero-livre.js';

describe('proximoNumeroLivre', () => {
  it('devolve o piso quando nada esta ocupado', () => {
    expect(proximoNumeroLivre(new Set())).toBe(String(NUMERO_MINIMO));
  });

  it('pula o piso quando ele ja esta ocupado', () => {
    const ocupados = new Set([String(NUMERO_MINIMO)]);

    expect(proximoNumeroLivre(ocupados)).toBe(String(NUMERO_MINIMO + 1));
  });

  /**
   * O PI confirmou: o numero da CATRACA NAO e sequencial. `MAX + 1` colidiria
   * com um numero baixo que outro cadastro ja usa -- esta e a razao de ser
   * desta funcao em vez do antigo `proximoExternalUserId`.
   */
  it('acha o buraco no meio da faixa, nao o maior + 1', () => {
    const ocupados = new Set([
      String(NUMERO_MINIMO),
      String(NUMERO_MINIMO + 1),
      String(NUMERO_MINIMO + 3), // buraco em +2
    ]);

    expect(proximoNumeroLivre(ocupados)).toBe(String(NUMERO_MINIMO + 2));
  });

  it('ignora numero fora da faixa do equipamento -- nao colide com o que nunca geraria', () => {
    const ocupados = new Set(['1', '42', '999999999999999']); // fora da faixa

    expect(proximoNumeroLivre(ocupados)).toBe(String(NUMERO_MINIMO));
  });

  it('ignora valor nao numerico', () => {
    const ocupados = new Set(['abc', '12.5', '-5']);

    expect(proximoNumeroLivre(ocupados)).toBe(String(NUMERO_MINIMO));
  });

  it('funciona no topo da faixa', () => {
    const ocupados = new Set([String(NUMERO_MAXIMO)]);

    // So prova que o numero maximo nao quebra a varredura -- nao varre a
    // faixa inteira (9*10^11 iteracoes), so confirma que ele e ignorado
    // quando ocupado e o restante da faixa (a partir do piso) resolve antes.
    expect(proximoNumeroLivre(ocupados)).toBe(String(NUMERO_MINIMO));
  });
});
