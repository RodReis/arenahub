import base from '@arenahub/config/eslint';

export default [
  ...base,
  {
    // Codigo nativo da ponte (C#, PowerShell, driver .mjs de teste manual)
    // nao e o TypeScript do projeto -- fica fora do lint.
    ignores: ['native/**'],
  },
  {
    // Diagnostico e main sao processos de linha de comando: console e a
    // interface deles, e o logger estruturado nao serve antes da config
    // existir.
    files: ['src/diagnostics/**/*.ts', 'src/main.ts'],
    rules: { 'no-console': 'off' },
  },
];
