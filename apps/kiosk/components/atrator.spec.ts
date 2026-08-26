import { describe, expect, it } from 'vitest';

import { partirSlogan } from './atrator.js';

/** ADR-042, Decisao 0: o hero vem da config, nunca literal. */
describe('slogan configurado vira kicker + headline', () => {
  it('duas frases: a primeira vira kicker em maiuscula', () => {
    expect(partirSlogan('Disciplina hoje. Resultados sempre.', 'ArenaHub')).toEqual({
      kicker: 'DISCIPLINA HOJE.',
      headline: ['Resultados sempre.'],
    });
  });

  it('tres frases: kicker + duas linhas de headline', () => {
    const { kicker, headline } = partirSlogan('Treine. Evolua. Conquiste.', 'ArenaHub');

    expect(kicker).toBe('TREINE.');
    expect(headline).toEqual(['Evolua.', 'Conquiste.']);
  });

  it('uma frase so vira headline, sem inventar kicker', () => {
    expect(partirSlogan('Sua melhor versao.', 'ArenaHub')).toEqual({
      kicker: null,
      headline: ['Sua melhor versao.'],
    });
  });

  /**
   * O §4 exige que a tela nao quebre sem os opcionais. Slogan vazio e o
   * padrao do seed -- um hero em branco seria exatamente quebrar.
   */
  it('slogan vazio cai no nome da academia', () => {
    expect(partirSlogan('', 'Arena Positiva')).toEqual({
      kicker: null,
      headline: ['Arena Positiva'],
    });
  });

  it('slogan so com espaco tambem cai no nome', () => {
    expect(partirSlogan('   ', 'Arena Positiva').headline).toEqual(['Arena Positiva']);
  });
});
