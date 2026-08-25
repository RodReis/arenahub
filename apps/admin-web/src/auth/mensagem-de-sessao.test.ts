import { describe, expect, it } from 'vitest';

import { MENSAGEM_DE_SESSAO, SESSAO_EXPIRADA } from './mensagem-de-sessao';

/*
 * A sessao expirava e a tela dizia "Nao foi possivel atribuir o plano
 * (AUTH_REQUIRED)" -- a recepcao lia como falha do plano, tentava de novo, e
 * so desistia (issue #187). O codigo cru dizia a verdade e nao ajudava
 * ninguem.
 */
describe('MENSAGEM_DE_SESSAO', () => {
  it('traduz AUTH_REQUIRED para uma frase que diz o que fazer', () => {
    expect(MENSAGEM_DE_SESSAO['AUTH_REQUIRED']).toBe(SESSAO_EXPIRADA);
  });

  it('cobre tambem a recusa de permissao, que nao e sessao expirada', () => {
    const forbidden = MENSAGEM_DE_SESSAO['FORBIDDEN'];

    expect(forbidden).toBeDefined();
    expect(forbidden).not.toBe(SESSAO_EXPIRADA);
  });

  /*
   * A FRASE PRECISA MANDAR ENTRAR DE NOVO. Sem isso vira mais um "algo deu
   * errado": informa que falhou sem dizer o que a pessoa deve fazer.
   */
  it('a frase de sessao expirada instrui a entrar de novo', () => {
    expect(SESSAO_EXPIRADA.toLowerCase()).toContain('entre de novo');
  });

  it('nao vaza codigo tecnico para a tela', () => {
    for (const frase of Object.values(MENSAGEM_DE_SESSAO)) {
      expect(frase).not.toMatch(/[A-Z_]{4,}/);
    }
  });
});
