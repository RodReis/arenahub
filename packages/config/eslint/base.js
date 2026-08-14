import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Configuracao base do ArenaHub.
 *
 * As regras aqui nao sao estilo: cada uma faz valer mecanicamente uma regra
 * escrita no CLAUDE.md ou no docs/CONVENTION.md. Regra que so existe em
 * documento nao vale -- por isso ela vive aqui.
 *
 * Uso, no eslint.config.js de cada workspace:
 *
 *   import base from '@arenahub/config/eslint';
 *   export default [...base];
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/*.generated.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
      },
    },

    rules: {
      // --- CLAUDE.md: "proibido any implicito" ---------------------------
      // O any explicito tambem cai: escapar do tipo tem de ser deliberado e
      // revisado, nao um atalho silencioso.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // --- CLAUDE.md: "unknown antes de validar dado externo" ------------
      // Zod no boundary. O catch tipado como unknown ja vem do tsconfig
      // (useUnknownInCatchVariables).
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',

      // --- Erro nao pode sumir em silencio -------------------------------
      // CLAUDE.md: "erro de dominio tem codigo estavel"; a regra global
      // proibe engolir rejeicao de promise.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',

      // --- CLAUDE.md: "nao logar template biometrico, token de pagamento,
      //     dado de cartao ou PII em erro" -------------------------------
      // console cru nao tem como ser auditado nem redigido. Log estruturado
      // entra com o card do observability.
      'no-console': 'error',

      // --- Higiene que o tsconfig sozinho nao pega ------------------------
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // Arquivos de configuracao rodam fora do type-check do projeto.
  {
    files: ['**/*.config.{js,mjs,cjs,ts}', '**/eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Prettier por ultimo: desliga o que conflita com formatacao.
  prettier,
);
