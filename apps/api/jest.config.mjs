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
  /*
   * 30 s, e nao os 5 s padrao do Jest -- issue #306.
   *
   * NA RAIZ, e nao dentro de `projects`: o Jest IGNORA `testTimeout` na
   * configuracao de projeto (verificado por canario -- um teste que dorme
   * 45 s continuava expirando em "5000 ms" com a chave la dentro). O preco
   * e que o teto vale tambem para o `unit`, onde nenhum teste chega perto
   * disso.
   *
   * Cada suite de integracao monta o `AppModule` INTEIRO no `beforeAll` e
   * fala com um Postgres de verdade. Na maquina local isso leva 1-2 s, mas
   * no CI o banco e um service container e a montagem passa dos 5 s com
   * folga suficiente para o teto virar sorteio.
   *
   * O SINTOMA NAO APONTAVA A CAUSA: a suite que estourava era diferente a
   * cada execucao (`engagement-placar-imutavel`, `platform-elevacao`,
   * `tenant-isolation`), e um `beforeAll` que expira derruba TODOS os testes
   * do arquivo de uma vez -- 12 de um golpe, parecendo defeito de logica.
   * Duas dessas falhas ocorreram na `main`, sem alteracao de fatia nenhuma,
   * o que fecha o diagnostico: e o teto, nao o codigo.
   *
   * Teto e rede contra travamento, nao medida de desempenho. Um teste que de
   * fato trave ainda falha, so que em 30 s.
   */
  testTimeout: 30_000,
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
      // Carrega o `.env` da raiz antes de qualquer suite subir modulo.
      setupFiles: ['<rootDir>/test/setup-env.ts'],
      // Sufixo `.int-spec.ts` e a convencao do repositorio
      // (`docs/TESTING.md` secao 1) -- e o que o `pnpm test:report`
      // classifica.
      testMatch: ['**/*.int-spec.ts'],
    },
  ],
};
