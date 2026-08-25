/**
 * Quando renovar a sessao -- regra pura, sem rede e sem cookie.
 *
 * O token de acesso vale 10 minutos (`ACESSO_VALIDO_POR_MS`, na API) e nada
 * o renovava: a aba parada perdia a sessao e toda Server Action falhava
 * calada, com a recepcao vendo "nao foi possivel" sem saber que o problema
 * era login (issue #187).
 *
 * Separada do `proxy.ts` de proposito. O `include` do Vitest cobre `src/**`
 * e `app/**`: um teste ao lado do proxy, na raiz, seria coletado ZERO vezes
 * e sairia verde sem rodar -- foi o que ja aconteceu com o primeiro teste de
 * Server Action.
 */

/**
 * Renova com esta antecedencia, nao no vencimento.
 *
 * Esperar expirar deixaria uma janela em que a requisicao ja saiu com token
 * morto -- a pagina renderizaria com 401 antes de a troca acontecer. Um
 * minuto cobre com folga o tempo de uma renderizacao e ainda usa 90% da
 * vida do token, sem transformar cada navegacao numa rotacao de refresh.
 */
export const MARGEM_DE_RENOVACAO_MS = 60 * 1000;

/**
 * Le o `exp` do JWT SEM conferir a assinatura.
 *
 * Deliberado: aqui so se decide QUANDO renovar. Quem valida credencial e a
 * API, a cada chamada. Conferir assinatura no proxy exigiria a chave publica
 * no bundle sem tornar nada mais seguro -- token forjado nao passa da API de
 * qualquer forma, e um `exp` mentiroso so provocaria uma renovacao a mais.
 */
function expiraEm(token: string): number | null {
  const partes = token.split('.');
  const payload = partes[1];

  if (partes.length !== 3 || payload === undefined || payload === '') return null;

  try {
    const conteudo: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    if (typeof conteudo !== 'object' || conteudo === null) return null;

    const exp = (conteudo as { exp?: unknown }).exp;

    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * `true` quando o token venceu ou esta prestes a vencer.
 *
 * TOKEN ILEGIVEL PEDE RENOVACAO. Nao da para saber quando expira, e o
 * refresh decide de verdade: no pior caso o usuario vai para o login, que e
 * o certo para credencial corrompida. Assumir "ainda vale" manteria a sessao
 * quebrada em silencio -- exatamente o bug que esta funcao existe para
 * fechar.
 */
export function precisaRenovar(token: string, agora: number): boolean {
  const expiraEmMs = expiraEm(token);

  if (expiraEmMs === null) return true;

  return expiraEmMs - agora <= MARGEM_DE_RENOVACAO_MS;
}
