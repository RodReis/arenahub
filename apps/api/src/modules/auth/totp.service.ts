import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

const PASSO_EM_SEGUNDOS = 30;
const DIGITOS = 6;
/** Tolera um passo para cada lado: relogio de celular anda alguns segundos fora. */
const JANELA = 1;
const BYTES_DE_SEGREDO = 20;
const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export interface ResultadoDeVerificacao {
  valido: boolean;
  /** Contador aceito, para gravar e barrar o reuso. */
  contador: bigint | null;
  motivo?: 'CODIGO_INVALIDO' | 'REPLAY' | 'MALFORMADO';
}

/**
 * TOTP conforme RFC 6238 -- HMAC-SHA1, passo de 30 s, 6 digitos.
 *
 * SHA-1 aqui NAO e descuido. O TOTP nao depende de resistencia a colisao;
 * depende de HMAC com chave secreta, e HMAC-SHA1 segue seguro para isso.
 * Mais importante: e o que Google Authenticator, Authy e 1Password
 * implementam -- trocar por SHA-256 daria conformidade no papel e um segundo
 * fator que nenhum aplicativo do usuario consegue ler.
 *
 * Implementado a mao, sem dependencia: sao ~40 linhas de RFC, testadas
 * contra os vetores oficiais. Uma biblioteca a mais no caminho de
 * autenticacao e superficie de supply chain que nao se paga aqui.
 */
@Injectable()
export class TotpService {
  gerarSegredo(): { bytes: Buffer; base32: string } {
    const bytes = randomBytes(BYTES_DE_SEGREDO);

    return { bytes, base32: this.paraBase32(bytes) };
  }

  gerarCodigo(segredo: Buffer, instanteEmSegundos: number): string {
    return this.calcular(segredo, BigInt(Math.floor(instanteEmSegundos / PASSO_EM_SEGUNDOS)));
  }

  /**
   * Verifica o codigo e devolve o contador aceito.
   *
   * `ultimoContador` e o que impede replay: o codigo vale 30 segundos, e sem
   * essa memoria quem interceptar tem meio minuto para reapresenta-lo. Aceita
   * so contador ESTRITAMENTE MAIOR que o ultimo -- barrar apenas o igual
   * deixaria voltar no tempo dentro da janela de tolerancia.
   */
  verificar(
    segredo: Buffer,
    codigo: string,
    instanteEmSegundos: number,
    ultimoContador: bigint | null,
  ): ResultadoDeVerificacao {
    if (!/^\d{6}$/.test(codigo)) {
      return { valido: false, contador: null, motivo: 'MALFORMADO' };
    }

    const contadorAtual = BigInt(Math.floor(instanteEmSegundos / PASSO_EM_SEGUNDOS));

    for (let desvio = -JANELA; desvio <= JANELA; desvio += 1) {
      const contador = contadorAtual + BigInt(desvio);

      if (contador < 0n) continue;

      if (!this.confere(this.calcular(segredo, contador), codigo)) continue;

      if (ultimoContador !== null && contador <= ultimoContador) {
        return { valido: false, contador: null, motivo: 'REPLAY' };
      }

      return { valido: true, contador };
    }

    return { valido: false, contador: null, motivo: 'CODIGO_INVALIDO' };
  }

  /** Codifica bytes de segredo ja existentes de volta para base32, para reexibir sem gerar outro. */
  paraBase32Publico(bytes: Buffer): string {
    return this.paraBase32(bytes);
  }

  montarUri(emissor: string, conta: string, segredoBase32: string): string {
    const rotulo = encodeURIComponent(`${emissor}:${conta}`);
    const parametros = new URLSearchParams({
      secret: segredoBase32,
      issuer: emissor,
      algorithm: 'SHA1',
      digits: String(DIGITOS),
      period: String(PASSO_EM_SEGUNDOS),
    });

    return `otpauth://totp/${rotulo}?${parametros.toString()}`;
  }

  private calcular(segredo: Buffer, contador: bigint): string {
    const bloco = Buffer.alloc(8);
    bloco.writeBigUInt64BE(contador);

    const digest = createHmac('sha1', segredo).update(bloco).digest();

    // Truncagem dinamica da RFC: o ultimo nibble aponta onde comecam os
    // quatro bytes que viram o codigo.
    const deslocamento = (digest[digest.length - 1] ?? 0) & 0x0f;
    const binario =
      (((digest[deslocamento] ?? 0) & 0x7f) << 24) |
      (((digest[deslocamento + 1] ?? 0) & 0xff) << 16) |
      (((digest[deslocamento + 2] ?? 0) & 0xff) << 8) |
      ((digest[deslocamento + 3] ?? 0) & 0xff);

    return String(binario % 10 ** DIGITOS).padStart(DIGITOS, '0');
  }

  private confere(esperado: string, recebido: string): boolean {
    const a = Buffer.from(esperado, 'utf8');
    const b = Buffer.from(recebido, 'utf8');

    // Tempo constante tambem aqui: comparar codigo de 6 digitos com `===`
    // vaza, digito a digito, qual prefixo estava certo.
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private paraBase32(bytes: Buffer): string {
    let bits = 0;
    let valor = 0;
    let saida = '';

    for (const byte of bytes) {
      valor = (valor << 8) | byte;
      bits += 8;

      while (bits >= 5) {
        saida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) saida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];

    return saida;
  }
}
