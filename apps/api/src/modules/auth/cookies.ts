/**
 * Nomes dos cookies de sessao.
 *
 * Em modulo proprio, e nao no controller, porque o `AuthGuard` tambem os le
 * -- e importar o controller de dentro do guard criaria ciclo entre o modulo
 * de seguranca e o de autenticacao.
 */
export const COOKIE_DE_ACESSO = 'arenahub_access';
export const COOKIE_DE_REFRESH = 'arenahub_refresh';

/** Le um cookie do cabecalho cru, sem depender de `cookie-parser`. */
export function lerCookie(cabecalho: string | undefined, nome: string): string | undefined {
  if (!cabecalho) return undefined;

  for (const parte of cabecalho.split(';')) {
    const [chave, ...resto] = parte.trim().split('=');

    if (chave === nome) return resto.join('=');
  }

  return undefined;
}
