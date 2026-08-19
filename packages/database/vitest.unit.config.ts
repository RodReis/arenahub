import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Sufixo `.spec.ts` e a convencao do repositorio (`docs/TESTING.md`
    // secao 1) para teste unitario -- funcao pura, sem banco.
    include: ['src/**/*.spec.ts'],
  },
});
