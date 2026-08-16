import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `jsdom`, nao `node`: componente precisa de DOM para render e query.
    // O pipeline de tokens continua testado em `accent.spec.ts`, que nao
    // toca DOM e roda igual nos dois ambientes.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
  },
});
