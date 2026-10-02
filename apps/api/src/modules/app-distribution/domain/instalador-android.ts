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

export const LIMITE_DA_MENSAGEM = 1000;

/**
 * Final do link curto (`/baixar/<slug>`, #538): 3 a 40 caracteres, minusculas,
 * numeros e hifen no meio. E o que o aluno digita se o link nao abrir -- sem
 * acento nem maiuscula, que o teclado do celular trocaria sozinho.
 */
const SLUG_DO_LINK = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

export function slugDoLinkValido(bruto: unknown): boolean {
  return typeof bruto === 'string' && SLUG_DO_LINK.test(bruto);
}
