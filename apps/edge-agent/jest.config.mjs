/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  // ESM exige extensao `.js` no import, mas o arquivo em disco e `.ts`.
  // Este mapeamento desfaz isso para o Jest.
  moduleNameMapper: { '^(\\.{1,2}/.*)[.]js$': '$1' },
  transform: {
    // verbatimModuleSyntax desligado so aqui: o ts-jest compila para o
    // formato que o runner espera, e a regra atrapalharia sem proteger nada.
    '^.+[.]ts$': ['ts-jest', { useESM: true, tsconfig: { verbatimModuleSyntax: false } }],
  },
};
