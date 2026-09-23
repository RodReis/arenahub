import base from '@arenahub/config/eslint';

export default [
  ...base,
  {
    // `main.ts` e processo de linha de comando: console e a interface dele
    // antes de o logger estruturado existir. Mesma excecao do edge-agent.
    //
    // `src/scripts/**` e a mesma excecao para scripts de importacao/manutencao
    // rodados manualmente (issue #386) -- mesmo padrao de `prisma/*.ts` em
    // `packages/database/eslint.config.js`.
    files: ['src/main.ts', 'src/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
