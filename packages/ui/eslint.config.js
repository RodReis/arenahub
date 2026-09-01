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
  {
    /*
     * O CANARIO DO GATE DE CONTRASTE PRECISA DO HEX QUE A REGRA 1 PROIBE.
     *
     * Ele planta cor reprovada no `totem.json`, roda o build e exige que
     * falhe -- e a unica forma de provar que a guarda reprova de verdade, em
     * vez de estar apenas ausente. Sem esta excecao a regra 1 barraria o
     * proprio teste que existe para provar a regra 4.
     *
     * Um arquivo, nominal, como as duas acima. O hex aqui nunca chega a
     * componente nem a tela: e entrada de teste, restaurada no `afterEach`.
     */
    files: ['src/gate-de-contraste-do-totem.spec.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
