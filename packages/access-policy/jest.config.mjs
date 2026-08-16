/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  // ESM exige extensao `.js` no import, mas o arquivo em disco e `.ts`.
  moduleNameMapper: { '^(\\.{1,2}/.*)[.]js$': '$1' },
  transform: {
    '^.+[.]ts$': ['ts-jest', { useESM: true, tsconfig: { verbatimModuleSyntax: false } }],
  },
};
