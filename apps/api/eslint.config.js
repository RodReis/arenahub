import base from '@arenahub/config/eslint';

export default [
  ...base,
  {
    // `main.ts` e processo de linha de comando: console e a interface dele
    // antes de o logger estruturado existir. Mesma excecao do edge-agent.
    files: ['src/main.ts'],
    rules: { 'no-console': 'off' },
  },
];
