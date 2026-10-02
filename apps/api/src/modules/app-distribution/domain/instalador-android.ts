export const LIMITE_DA_URL = 2048;
export const LIMITE_DA_VERSAO = 40;

/**
 * URL que o QR vai ABRIR no celular do aluno -- por isso o esquema e conferido
 * aqui, no servidor. `javascript:` executa codigo; `http:` entrega o aluno a um
 * intermediario. Mesmo criterio de `urlSegura` em `politica-de-versao.ts`.
 */
export function urlDeInstaladorValida(bruta: unknown): boolean {
  if (typeof bruta !== 'string' || bruta === '' || bruta.length > LIMITE_DA_URL) return false;

  try {
    const url = new URL(bruta);

    // `https://usuario:senha@host`: credencial na URL vai parar no QR, no
    // log do proxy e no historico do navegador do aluno.
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}
