/**
 * Declaracao ambiente de CSS Modules.
 *
 * O TypeScript nao sabe o que um `.module.css` exporta -- sem isto,
 * `import estilos from './X.module.css'` vira `any` implicito e o ESLint
 * type-aware reprova com `no-unsafe-assignment`.
 *
 * `Record<string, string>` e o mais estrito que da para afirmar sem gerar
 * tipo por arquivo: o Vite entrega um objeto de classe por nome. Classe
 * inexistente devolve `undefined`, entao quem le trata como opcional --
 * nao ha ganho em fingir que o conjunto de chaves e conhecido.
 *
 * Consequencia: com `noPropertyAccessFromIndexSignature` ligado no tsconfig
 * base, o acesso e por colchete (`estilos['badge']`), nao por ponto.
 */
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
