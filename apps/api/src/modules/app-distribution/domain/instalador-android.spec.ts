import { describe, expect, it } from '@jest/globals';

import { LIMITE_DA_URL, slugDoLinkValido, urlDeInstaladorValida } from './instalador-android.js';

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
    ['com usuario e senha na URL', 'https://usuario:senha@expo.dev/a.apk'],
    ['gigante', `https://expo.dev/${'a'.repeat(LIMITE_DA_URL)}`],
  ])('recusa %s', (_caso, valor) => {
    expect(urlDeInstaladorValida(valor)).toBe(false);
  });
});

describe('slugDoLinkValido (#538)', () => {
  it.each(['arena', 'arena-positiva', 'clinica2', 'a1b'])('aceita "%s"', (slug) => {
    expect(slugDoLinkValido(slug)).toBe(true);
  });

  it.each([
    ['curto demais', 'ab'],
    ['maiusculas', 'Arena'],
    ['espaco', 'arena positiva'],
    ['acento', 'clínica'],
    ['hifen nas pontas', '-arena'],
    ['hifen no fim', 'arena-'],
    ['barra', 'arena/x'],
    ['longo demais', 'a'.repeat(41)],
    ['nao string', 7],
  ])('recusa %s', (_caso, slug) => {
    expect(slugDoLinkValido(slug)).toBe(false);
  });
});
