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
    return new URL(bruta).protocol === 'https:';
  } catch {
    return false;
  }
}
