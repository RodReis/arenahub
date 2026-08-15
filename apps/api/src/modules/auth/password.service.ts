import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

import { Injectable } from '@nestjs/common';

// `promisify(scrypt)` perde a sobrecarga que aceita `ScryptOptions`. O
// wrapper manual preserva os quatro argumentos com tipo.
function derivar(
  senha: string,
  sal: Buffer,
  tamanho: number,
  opcoes: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    scrypt(senha, sal, tamanho, opcoes, (erro, chave) => {
      if (erro) rejeitar(erro);
      else resolver(chave);
    });
  });
}

/**
 * Parametros de custo. Ficam no envelope de cada senha, nao so aqui: subir o
 * custo no futuro invalidaria toda senha ja gravada se o valor vivesse
 * apenas nesta constante. Com o parametro gravado, a senha antiga continua
 * conferindo e migra na proxima troca.
 */
const ALGORITMO = 'scrypt';
const VERSAO = 1;
const CUSTO_N = 16_384;
const BLOCO_R = 8;
const PARALELISMO_P = 1;
const BYTES_DE_SAL = 16;
const BYTES_DE_HASH = 64;

@Injectable()
export class PasswordService {
  async gerarHash(senha: string): Promise<string> {
    const sal = randomBytes(BYTES_DE_SAL);
    const hash = await this.derivarChave(senha, sal);

    return [
      ALGORITMO,
      `v=${VERSAO}`,
      `N=${CUSTO_N}`,
      `r=${BLOCO_R}`,
      `p=${PARALELISMO_P}`,
      sal.toString('base64url'),
      hash.toString('base64url'),
    ].join('$');
  }

  /**
   * Envelope invalido devolve `false` em vez de lancar.
   *
   * Registro corrompido no banco nao pode derrubar o login com stack trace:
   * para quem tenta entrar, o resultado e o mesmo ("senha invalida"), e o
   * operador investiga pelo log -- nao pela pagina de erro do usuario.
   */
  async conferir(senha: string, envelope: string): Promise<boolean> {
    const partes = envelope.split('$');

    if (partes.length !== 7) return false;

    const [algoritmo, versao, custo, bloco, paralelismo, salBase64, hashBase64] = partes;

    if (
      algoritmo !== ALGORITMO ||
      versao !== `v=${VERSAO}` ||
      custo !== `N=${CUSTO_N}` ||
      bloco !== `r=${BLOCO_R}` ||
      paralelismo !== `p=${PARALELISMO_P}` ||
      !salBase64 ||
      !hashBase64
    ) {
      return false;
    }

    const sal = Buffer.from(salBase64, 'base64url');
    const hashEsperado = Buffer.from(hashBase64, 'base64url');

    if (sal.length !== BYTES_DE_SAL || hashEsperado.length !== BYTES_DE_HASH) return false;

    const hashCalculado = await this.derivarChave(senha, sal);

    // Comparacao em tempo constante: `===` sai no primeiro byte diferente, e
    // a diferenca de tempo entre "errou no primeiro caractere" e "errou no
    // ultimo" vaza o hash byte a byte.
    return timingSafeEqual(hashCalculado, hashEsperado);
  }

  private async derivarChave(senha: string, sal: Buffer): Promise<Buffer> {
    return derivar(senha, sal, BYTES_DE_HASH, {
      N: CUSTO_N,
      r: BLOCO_R,
      p: PARALELISMO_P,
      // scrypt precisa de memoria proporcional a N*r*128; o padrao do Node
      // (32 MB) estoura com N=16384 e r=8, e o erro sai como "invalid
      // params", sem dizer que falta memoria.
      maxmem: 64 * 1024 * 1024,
    });
  }
}
