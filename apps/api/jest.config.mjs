/**
 * Dois projetos, porque as suites tem custo e pre-requisito diferentes:
 *
 * - `unit` roda em qualquer maquina, sem infraestrutura;
 * - `integration` sobe dependencia externa (Postgres) e roda serializado.
 *
 * O comando raiz `pnpm test` chama so o primeiro; `pnpm test:integration`
 * chama o segundo. Misturar os dois faria o CI barato depender de Docker.
 */

/** @type {import('ts-jest').JestConfigWithTsJest} */
const transformacaoTs = {
  // verbatimModuleSyntax desligado so aqui: o ts-jest compila para o formato
  // que o runner espera, e a regra atrapalharia sem proteger nada.
  '^.+[.]ts$': ['ts-jest', { useESM: true, tsconfig: { verbatimModuleSyntax: false } }],
};

const base = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  // ESM exige extensao `.js` no import, mas o arquivo em disco e `.ts`.
  moduleNameMapper: { '^(\\.{1,2}/.*)[.]js$': '$1' },
  transform: transformacaoTs,
};

/** @type {import('jest').Config} */
export default {
  projects: [
    {
      ...base,
      displayName: 'unit',
      roots: ['<rootDir>/src'],
      testMatch: ['**/*.spec.ts'],
    },
    {
      ...base,
      displayName: 'integration',
      roots: ['<rootDir>/test/integration'],
      // Sufixo `.int-spec.ts` e a convencao do repositorio
      // (`docs/TESTING.md` secao 1) -- e o que o `pnpm test:report`
      // classifica.
      testMatch: ['**/*.int-spec.ts'],
    },
  ],
};
