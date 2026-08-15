import { defineConfig, devices } from '@playwright/test';

const PORTA_DA_WEB = 3000;
const PORTA_DA_API = 3344;

/**
 * E2E de verdade: sobe a API e o painel, e navega como um operador.
 *
 * `webServer` com DOIS processos porque a jornada atravessa os dois -- um
 * teste que sobe so o front e mocka a API prova que o front funciona contra
 * um dublê, nao que a fatia funciona.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e-spec.ts',
  // Serial: os testes compartilham o banco semeado. Em paralelo, o logout de
  // um derrubaria a sessao do outro.
  workers: 1,
  fullyParallel: false,
  // `forbidOnly` no CI: `test.only` esquecido faria o CI passar rodando um
  // teste so, com o verde parecendo igual.
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: `http://localhost:${PORTA_DA_WEB}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // `start` (dist compilado), e nao `dev` (tsx): o esbuild por tras do
      // `tsx` NAO implementa `emitDecoratorMetadata`, e sem
      // `design:paramtypes` a injecao por tipo do Nest falha em runtime --
      // erro que so aparece ao subir o processo, nunca no typecheck.
      command: 'pnpm --filter @arenahub/api start',
      url: `http://localhost:${PORTA_DA_API}/health/live`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @arenahub/admin-web start',
      url: `http://localhost:${PORTA_DA_WEB}/login`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
  ],
});
