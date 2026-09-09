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
      /*
       * `server-only` vira modulo vazio no teste.
       *
       * O pacote real e uma guarda de BUNDLE: seu `index.js` lanca sempre, e
       * quem o torna inofensivo no servidor e a condicao `react-server` do
       * `package.json`, que o Next resolve e o Vitest nao. Sem este alias,
       * TODO modulo que importa `server-only` fica intestavel -- o import
       * estoura antes de o primeiro `it` rodar.
       *
       * O alias NAO afrouxa a guarda: quem decide o que vai ao bundle e o
       * `next build`, que continua vendo o pacote de verdade. Aqui ele so
       * some do caminho do runner.
       */
      'server-only': fileURLToPath(new URL('./test/server-only-vazio.ts', import.meta.url)),
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
    /*
     * `app/**` precisa de `.ts` E `.tsx`.
     *
     * So `.tsx` estava listado, e o primeiro teste de Server Action (que nao
     * tem JSX, logo e `.ts`) foi coletado ZERO vezes -- `vitest run` saia
     * verde com o arquivo inteiro ignorado, que e indistinguivel de um
     * arquivo que passou. Foi assim que quase entregamos a troca de plano
     * "testada" sem nenhum teste dela ter rodado.
     */
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'app/**/*.test.ts',
      'app/**/*.test.tsx',
    ],
  },
});
