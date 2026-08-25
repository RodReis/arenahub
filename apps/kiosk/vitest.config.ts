import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `tsconfig.json` fixa `jsx: "preserve"` -- e o Next quem transforma JSX no
  // build real. Este Vite roda sobre oxc, que le o mesmo tsconfig e recusa
  // 'preserve' sem plugin de framework; forcar `oxc.jsx` da ao teste seu
  // proprio transform sem tocar no tsconfig de que o `next build` depende.
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    /**
     * `.ts` E `.tsx` nos dois diretorios, pelo mesmo motivo do `admin-web`:
     * arquivo fora do glob e coletado ZERO vezes, e `vitest run` sai verde
     * com o teste inteiro ignorado -- indistinguivel de um teste que passou.
     */
    include: [
      'lib/**/*.spec.ts',
      'lib/**/*.spec.tsx',
      'components/**/*.spec.ts',
      'components/**/*.spec.tsx',
      'app/**/*.spec.ts',
      'app/**/*.spec.tsx',
    ],
  },
});
