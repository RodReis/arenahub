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

  /**
   * Decisao do PI (08/10/2026): o numero automatico comeca em 10.000 (5
   * digitos), nao em 100.000.000.000. Abaixo do piso ficam os numeros do
   * software de fabrica (1, 2, 3...) -- eles nao contam e nunca sao gerados.
   */
  it('comeca em 10000 e nunca gera numero do software de fabrica', () => {
    expect(NUMERO_MINIMO).toBe(10_000);
    expect(proximoNumeroLivre(new Set(['1', '2', '3', '9999']))).toBe('10000');
  });

  it('numero curto ja existente (ex.: importado, 26633) conta como ocupado e nunca e repetido', () => {
    const ocupados = new Set<string>();
    for (let n = NUMERO_MINIMO; n <= 26_633; n += 1) ocupados.add(String(n));

    expect(proximoNumeroLivre(ocupados)).toBe('26634');
  });

  /**
   * UNICIDADE: para qualquer conjunto de ocupados, o resultado nunca esta nele
   * e e o PRIMEIRO livre (nenhum numero livre fica para tras). Conjuntos
   * pseudo-aleatorios deterministas (LCG), com ruido fora da faixa.
   */
  it('nunca devolve numero ocupado e sempre o primeiro livre, em conjuntos variados', () => {
    let semente = 12345;
    const proximo = (limite: number): number => {
      semente = (semente * 1_103_515_245 + 12_345) % 2_147_483_648;
      return semente % limite;
    };

    for (let rodada = 0; rodada < 200; rodada += 1) {
      const ocupados = new Set<string>(['1', '42', '9999', 'abc']);
      const quantidade = proximo(300);
      for (let i = 0; i < quantidade; i += 1) ocupados.add(String(NUMERO_MINIMO + proximo(400)));

      const resultado = proximoNumeroLivre(ocupados);

      expect(ocupados.has(resultado)).toBe(false);
      expect(Number(resultado)).toBeGreaterThanOrEqual(NUMERO_MINIMO);
      for (let n = NUMERO_MINIMO; n < Number(resultado); n += 1) {
        expect(ocupados.has(String(n))).toBe(true);
      }
    }
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
