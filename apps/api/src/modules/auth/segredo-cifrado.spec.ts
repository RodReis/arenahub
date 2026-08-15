import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { CifradorDeSegredo } from './segredo-cifrado.js';

const CHAVE = randomBytes(32);

describe('CifradorDeSegredo', () => {
  const cifrador = new CifradorDeSegredo(CHAVE);

  it('cifra e decifra de volta', () => {
    const original = randomBytes(20);
    const cifrado = cifrador.cifrar(original);

    expect(cifrador.decifrar(cifrado).equals(original)).toBe(true);
  });

  it('nao guarda o segredo em claro no ciphertext', () => {
    const original = Buffer.from('12345678901234567890', 'ascii');
    const cifrado = cifrador.cifrar(original);

    expect(cifrado.ciphertext.includes(original)).toBe(false);
  });

  it('usa IV diferente a cada cifragem', () => {
    // IV repetido em GCM e falha catastrofica: dois textos cifrados com o
    // mesmo par (chave, IV) permitem recuperar o XOR dos claros.
    const original = randomBytes(20);

    expect(cifrador.cifrar(original).iv.equals(cifrador.cifrar(original).iv)).toBe(false);
  });

  it('recusa ciphertext adulterado', () => {
    const cifrado = cifrador.cifrar(randomBytes(20));
    const adulterado = Buffer.from(cifrado.ciphertext);
    adulterado[0] = (adulterado[0] ?? 0) ^ 0xff;

    // A tag do GCM e o que transforma adulteracao em erro em vez de lixo
    // silencioso -- sem autenticacao, o segredo decifrado errado viraria
    // codigo TOTP errado, e o usuario levaria a culpa.
    expect(() => cifrador.decifrar({ ...cifrado, ciphertext: adulterado })).toThrow();
  });

  it('recusa tag adulterada', () => {
    const cifrado = cifrador.cifrar(randomBytes(20));
    const tag = Buffer.from(cifrado.tag);
    tag[0] = (tag[0] ?? 0) ^ 0xff;

    expect(() => cifrador.decifrar({ ...cifrado, tag })).toThrow();
  });

  it('recusa decifragem com outra chave', () => {
    const cifrado = cifrador.cifrar(randomBytes(20));
    const outro = new CifradorDeSegredo(randomBytes(32));

    expect(() => outro.decifrar(cifrado)).toThrow();
  });

  it('recusa chave de tamanho errado', () => {
    // AES-256 exige 32 bytes. Chave curta aceita silenciosamente daria uma
    // cifra mais fraca do que a documentacao promete.
    expect(() => new CifradorDeSegredo(randomBytes(16))).toThrow();
  });
});
