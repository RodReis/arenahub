import base from '@arenahub/config/eslint';

export default [
  // Codigo gerado pelo Prisma nao se linta: nao e nosso e e recriado a cada
  // `generate`. Tambem esta fora do tsconfig, entao o parser type-aware
  // falharia nele.
  // `scripts/**` sao programas de manutencao em JavaScript solto, rodados por
  // `node` direto e fora do tsconfig -- o parser type-aware falha neles com
  // "was not found by the project service". Desligar `project` so para eles
  // quebraria as regras que exigem tipo, entao ficam fora do lint.
  { ignores: ['src/generated/**', 'scripts/**'] },
  ...base,
  {
    // Seed e scripts de manutencao sao programas de linha de comando: console
    // e a interface deles, nao debug esquecido.
    files: ['prisma/seed.ts', 'prisma/seed-demo.ts', 'scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },

];
