import { describe, expect, it } from '@jest/globals';

import { modalidadeAutorizada } from './entitlement.js';

describe('modalidadeAutorizada', () => {
  it('autoriza tudo quando o plano nao tem nenhum entitlement cadastrado', () => {
    expect(modalidadeAutorizada([], 'modalidade-x')).toBe(true);
  });

  it('autoriza a modalidade que esta na lista', () => {
    expect(modalidadeAutorizada(['yoga-id', 'cross-id'], 'yoga-id')).toBe(true);
  });

  it('recusa a modalidade que nao esta na lista quando a lista nao e vazia', () => {
    expect(modalidadeAutorizada(['yoga-id'], 'cross-id')).toBe(false);
  });
});
