import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Espelha o `paths` do tsconfig.json (`@/* -> ./src/*`). Nenhum teste em
  // `src/**` precisava do alias ate agora -- o primeiro import de
  // `@/components/ui/*` em `app/**` (o wizard de cadastro) expos que o Vite
  // nao le `tsconfig.json` sozinho, e resolver isso com um pacote novo
  // (`vite-tsconfig-paths`) violaria "nenhuma dependencia nova" da tarefa.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // `tsconfig.json` fixa `jsx: "preserve"` -- e o Next quem transforma JSX
  // no build real. Este Vite roda sobre oxc (rolldown-vite), que le o mesmo
  // tsconfig e recusa 'preserve' sem plugin de framework; forcar `oxc.jsx`
  // aqui da ao teste seu proprio transform, sem tocar no tsconfig de que o
  // `next build` depende. `esbuild.jsx` fica de fora -- esta versao ignora e
  // avisa quando os dois estao setados.
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    // `jsdom` para todo mundo: os caminhos de rota (`[id]`, `[sessionId]`)
    // tem colchete, que `environmentMatchGlobs` le como classe de caracter
    // -- o glob nunca casava e o teste de componente caia em `node` sem
    // `document`. As regras puras de `src/**` nao tocam DOM; rodar em jsdom
    // nao muda o resultado delas, so a environment usada por baixo.
    environment: 'jsdom',
    // `globals: true` -- sem ele o RTL nao registra o `afterEach` que
    // desmonta o componente entre testes, e o segundo `render` empilha em
    // cima do primeiro (foi assim que "Confirmar" virou multiplo botao).
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'app/**/*.test.tsx'],
  },
});
