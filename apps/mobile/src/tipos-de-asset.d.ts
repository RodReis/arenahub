/**
 * O Metro resolve `import arte from './x.jpg'` para o id numerico do asset.
 *
 * Declarado aqui porque o `expo-env.d.ts`, que traria isto do `expo/types`,
 * e gerado pelo `expo start` e nao entra no repositorio -- sem esta linha o
 * typecheck do CI nao conheceria o modulo.
 */
declare module '*.jpg' {
  const asset: number;
  export default asset;
}
