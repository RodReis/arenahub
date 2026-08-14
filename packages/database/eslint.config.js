import base from '@arenahub/config/eslint';

export default [
  // Codigo gerado pelo Prisma nao se linta: nao e nosso e e recriado a cada
  // `generate`. Tambem esta fora do tsconfig, entao o parser type-aware
  // falharia nele.
  { ignores: ['src/generated/**'] },
  ...base,
  {
    // O seed e um script de linha de comando: console e a interface dele.
    files: ['prisma/seed.ts'],
    rules: { 'no-console': 'off' },
  },
];
