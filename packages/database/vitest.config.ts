import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    // Carrega o `.env` da raiz antes de qualquer suite abrir client.
    setupFiles: ['./test/setup-env.ts'],
    // As suites compartilham o Postgres do docker-compose. Rodar em paralelo
    // faria arquivos diferentes disputarem o mesmo banco -- o teste passaria
    // ou falharia conforme a ordem, que e a definicao de teste inutil.
    fileParallelism: false,
    // Subir schema e conectar custa mais que um teste puro de funcao.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
