import { randomBytes, scrypt, type ScryptOptions } from 'node:crypto';

/**
 * Mesmo envelope do `PasswordService` da API.
 *
 * Duplicado de proposito em relacao a API: o pacote de banco nao depende
 * dela, e inverter essa dependencia para reaproveitar uma funcao de 15
 * linhas custaria mais do que resolve. Dentro do proprio pacote, porem, e
 * uma fonte so -- `seed.ts` e `bootstrap-tenant` usam esta.
 */

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

export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await derivar(senha, sal, 64, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });

  return `scrypt$v=1$N=16384$r=8$p=1$${sal.toString('base64url')}$${hash.toString('base64url')}`;
}
