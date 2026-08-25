import { describe, expect, it } from 'vitest';

import { precisaRenovar, MARGEM_DE_RENOVACAO_MS } from './sessao';

/**
 * A decisao de renovar, isolada do proxy.
 *
 * Ela mora em `src/` e nao no `proxy.ts` da raiz por dois motivos: o
 * `include` do Vitest cobre `src/**` e `app/**` -- um teste na raiz seria
 * coletado ZERO vezes e sairia verde sem rodar (foi o que ja aconteceu com o
 * primeiro teste de Server Action) -- e porque a regra e pura: entra token e
 * "agora", sai booleano, sem rede nem cookie.
 */
function tokenComExp(expEmSegundos: number | undefined): string {
  const cabecalho = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const corpo = Buffer.from(
    JSON.stringify(expEmSegundos === undefined ? { sub: 'u' } : { sub: 'u', exp: expEmSegundos }),
  ).toString('base64url');

  return `${cabecalho}.${corpo}.assinatura-que-nao-conferimos`;
}

const AGORA = new Date('2026-08-25T12:00:00.000Z').getTime();
const emSegundos = (ms: number): number => Math.floor(ms / 1000);

describe('precisaRenovar', () => {
  it('nao renova token recem-emitido', () => {
    const token = tokenComExp(emSegundos(AGORA + 10 * 60 * 1000));

    expect(precisaRenovar(token, AGORA)).toBe(false);
  });

  /*
   * O CASO QUE DA NOME AO BUG. O token vale 10 minutos e nada renovava: a
   * aba parada perdia a sessao e toda Server Action falhava calada.
   */
  it('renova token ja expirado', () => {
    const token = tokenComExp(emSegundos(AGORA - 1000));

    expect(precisaRenovar(token, AGORA)).toBe(true);
  });

  /*
   * ANTES de expirar, nao depois. Esperar o vencimento deixaria uma janela
   * em que a requisicao ja saiu com token morto -- renovar dentro da margem
   * e o que torna a troca invisivel para quem opera.
   */
  it('renova dentro da margem, com o token ainda valido', () => {
    const token = tokenComExp(emSegundos(AGORA + MARGEM_DE_RENOVACAO_MS - 5000));

    expect(precisaRenovar(token, AGORA)).toBe(true);
  });

  it('nao renova logo antes da margem', () => {
    const token = tokenComExp(emSegundos(AGORA + MARGEM_DE_RENOVACAO_MS + 5000));

    expect(precisaRenovar(token, AGORA)).toBe(false);
  });

  /*
   * TOKEN ILEGIVEL NAO E TOKEN VALIDO.
   *
   * Nao da para saber quando expira, entao a resposta segura e "tente
   * renovar": o refresh decide de verdade, e no pior caso o usuario vai para
   * o login -- que e o comportamento correto para credencial corrompida. O
   * inverso (assumir valido) manteria a sessao quebrada em silencio, que e
   * exatamente o bug desta issue.
   */
  it.each([
    ['string vazia', ''],
    ['nao e JWT', 'lixo'],
    ['partes de menos', 'a.b'],
    ['payload que nao e base64 de JSON', 'a.$$$.c'],
    ['sem exp', tokenComExp(undefined)],
  ])('pede renovacao quando o token e ilegivel: %s', (_caso, token) => {
    expect(precisaRenovar(token, AGORA)).toBe(true);
  });

  /*
   * A ASSINATURA NAO E CONFERIDA AQUI, E ISSO E DELIBERADO. O proxy so
   * decide QUANDO renovar; quem valida credencial e a API, a cada chamada.
   * Conferir assinatura no Edge exigiria a chave publica no bundle do proxy
   * sem tornar nada mais seguro -- um token forjado nao passa da API de
   * qualquer forma.
   */
  it('decide pelo exp mesmo com assinatura arbitraria', () => {
    const token = `${tokenComExp(emSegundos(AGORA + 10 * 60 * 1000)).split('.').slice(0, 2).join('.')}.qualquer-coisa`;

    expect(precisaRenovar(token, AGORA)).toBe(false);
  });
});
