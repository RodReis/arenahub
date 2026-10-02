import { describe, expect, it } from '@jest/globals';

import { LIMITE_DA_URL, urlDeInstaladorValida } from './instalador-android.js';

describe('urlDeInstaladorValida', () => {
  it('aceita https', () => {
    expect(urlDeInstaladorValida('https://expo.dev/artifacts/eas/abc.apk')).toBe(true);
  });

  it.each([
    ['http', 'http://expo.dev/a.apk'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html;base64,AAAA'],
    ['vazia', ''],
    ['sem esquema', 'expo.dev/a.apk'],
    ['nao string', 42],
    ['gigante', `https://expo.dev/${'a'.repeat(LIMITE_DA_URL)}`],
  ])('recusa %s', (_caso, valor) => {
    expect(urlDeInstaladorValida(valor)).toBe(false);
  });
});
