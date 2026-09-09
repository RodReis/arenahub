/**
 * Dublê de `server-only` para o Vitest.
 *
 * O pacote real lança no import; a condição `react-server` do `package.json`
 * é que o torna inofensivo no servidor, e o Vitest não a resolve. Sem este
 * arquivo, todo módulo marcado como exclusivo do servidor fica intestável.
 *
 * Vazio de propósito -- ver o comentário do alias em `vitest.config.ts`.
 */
export {};
