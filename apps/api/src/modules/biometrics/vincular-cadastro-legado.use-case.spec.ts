import { describe, expect, it } from '@jest/globals';

import { idadeEmAnos } from './vincular-cadastro-legado.use-case.js';

/** A idade que o consentimento legado congela (INV-143) -- #468. */
describe('idadeEmAnos', () => {
  const nascimento = new Date('1990-06-15T00:00:00.000Z');

  it('conta o ano quando o aniversario ja passou', () => {
    expect(idadeEmAnos(nascimento, new Date('2026-09-30T12:00:00.000Z'))).toBe(36);
  });

  it('nao conta o ano antes do aniversario', () => {
    expect(idadeEmAnos(nascimento, new Date('2026-06-14T23:59:59.000Z'))).toBe(35);
  });

  it('conta o ano no proprio dia do aniversario', () => {
    expect(idadeEmAnos(nascimento, new Date('2026-06-15T00:00:00.000Z'))).toBe(36);
  });
});
