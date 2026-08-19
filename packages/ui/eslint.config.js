import base from '@arenahub/config/eslint';
import designSystem from '@arenahub/config/eslint/design-system';
import react from '@arenahub/config/eslint/react';

export default [
  ...base,
  ...designSystem,
  ...react,
  {
    // `tokens/**` e a UNICA fonte legitima de hex do repositorio -- e o que a
    // regra 1 protege. `*.generated.ts` e saida do pipeline, nao codigo a mao.
    ignores: ['dist/**', 'dist-tokens/**', 'tokens/**', 'src/*.generated.ts'],
  },
  {
    // O resolvedor de accent E a implementacao da rampa: ele precisa dos
    // literais de branco e da matematica OKLCH que a regra 1 proibe em
    // componente. Excecao estreita, um arquivo, com motivo escrito.
    files: ['src/accent.ts', 'src/contrast.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
