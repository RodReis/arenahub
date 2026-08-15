import { describe, expect, it } from '@jest/globals';

import { lerVersaoDaApi } from './version.js';

describe('lerVersaoDaApi', () => {
  it('devolve a versao declarada no package.json do workspace', () => {
    // O valor exato nao importa; importa que venha do manifesto e nao de um
    // literal no codigo, que envelhece sem ninguem perceber.
    expect(lerVersaoDaApi()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('devolve sempre a mesma versao em chamadas repetidas', () => {
    expect(lerVersaoDaApi()).toBe(lerVersaoDaApi());
  });
});
