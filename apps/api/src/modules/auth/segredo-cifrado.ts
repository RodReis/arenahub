import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';
const BYTES_DE_CHAVE = 32;
const BYTES_DE_IV = 12;

export interface SegredoCifrado {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

/**
 * Cifra o segredo TOTP com AES-256-GCM.
 *
 * GCM, e nao CBC: o modo autenticado transforma adulteracao em ERRO em vez
 * de lixo silencioso. Sem a tag, um byte trocado no banco produziria um
 * segredo decifrado diferente, codigos TOTP errados, e o usuario levando a
 * culpa por um dado corrompido que ninguem detectou.
 *
 * Os tres campos andam juntos no banco (`mfa_secret_ciphertext`,
 * `mfa_secret_iv`, `mfa_secret_tag`) porque decifrar exige os tres.
 */
export class CifradorDeSegredo {
  constructor(private readonly chave: Buffer) {
    if (chave.length !== BYTES_DE_CHAVE) {
      throw new Error(
        `MFA_ENCRYPTION_KEY precisa de ${BYTES_DE_CHAVE} bytes; recebeu ${chave.length}.`,
      );
    }
  }

  cifrar(segredo: Buffer): SegredoCifrado {
    // IV novo a cada cifragem. Reutilizar IV em GCM e falha catastrofica:
    // dois textos sob o mesmo par (chave, IV) revelam o XOR dos claros.
    const iv = randomBytes(BYTES_DE_IV);
    const cifra = createCipheriv(ALGORITMO, this.chave, iv);

    const ciphertext = Buffer.concat([cifra.update(segredo), cifra.final()]);

    return { ciphertext, iv, tag: cifra.getAuthTag() };
  }

  /** Lanca se a tag nao confere -- adulteracao nao passa silenciosa. */
  decifrar(cifrado: SegredoCifrado): Buffer {
    const decifra = createDecipheriv(ALGORITMO, this.chave, cifrado.iv);

    decifra.setAuthTag(cifrado.tag);

    return Buffer.concat([decifra.update(cifrado.ciphertext), decifra.final()]);
  }
}
