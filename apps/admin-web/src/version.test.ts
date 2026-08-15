import { describe, expect, it } from 'vitest';

import { lerVersaoDoPainel } from './version';

describe('lerVersaoDoPainel', () => {
  it('devolve a versao declarada no package.json do workspace', () => {
    expect(lerVersaoDoPainel()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('devolve sempre a mesma versao em chamadas repetidas', () => {
    expect(lerVersaoDoPainel()).toBe(lerVersaoDoPainel());
  });
});
