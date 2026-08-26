import { defineConfig, devices } from '@playwright/test';

/**
 * O Playwright NAO carrega `.env` sozinho: ele le este config num processo
 * proprio, que nao herda o `--env-file` do script que o chamou. Sem esta
 * linha, `E2E_DATABASE_URL` existe no `.env`, o `pretest:e2e` prepara o banco
 * certo -- e a suite morre em seguida dizendo que a variavel nao existe.
 *
 * `loadEnvFile` e do proprio Node (22+), entao nao entra dependencia nova. Nao
 * sobrescreve variavel ja presente no ambiente: no CI o valor vem do job.
 *
 * O `try` existe porque no CI nao HA `.env` -- e `loadEnvFile` lanca quando o
 * arquivo falta. Ausencia nao e erro aqui; falta de variavel e, e quem reclama
 * disso e a checagem logo abaixo, com mensagem que diz o que fazer.
 */
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // Sem `.env`: as variaveis vem do ambiente (CI).
}

const PORTA_DA_WEB = 3000;
const PORTA_DA_API = 3344;

/**
 * Banco do E2E -- card [INFRA], issue #101.
 *
 * A suite E2E CRIA aluno, plano e dispositivo e NAO limpa o que criou (os
 * testes de integracao limpam com `deleteMany`; estes, nao). Enquanto ela
 * apontou para o mesmo `DATABASE_URL` do desenvolvimento, cada execucao
 * deixava residuo com epoch no nome -- `Caminho Biometria 1787060177858`,
 * `Historico 1787060176169` -- e a tela de Alunos passou a exibir dezenas de
 * linhas de lixo da propria suite. O painel mostrava o rastro do CI, nao o
 * produto.
 *
 * `E2E_DATABASE_URL` isola isso. Mesmo Postgres, banco separado: nao precisa
 * de container novo, e o lixo fica onde ninguem olha.
 *
 * NAO ha padrao nem fallback para `DATABASE_URL`. Cair no banco de
 * desenvolvimento em silencio e o defeito que este bloco existe para impedir,
 * e um default embutido carregaria a porta da maquina de quem o escreveu --
 * aqui o Postgres do projeto atende em 5442, e a 5432 e de outro projeto.
 * Falta a variavel, a suite para e diz o que falta.
 */
const URL_DO_BANCO_E2E = process.env['E2E_DATABASE_URL'];

if (!URL_DO_BANCO_E2E) {
  throw new Error(
    'E2E_DATABASE_URL nao definida. Copie a linha do `.env.example` para o seu ' +
      '`.env` e ajuste a porta para a do seu Postgres (veja POSTGRES_PORT).',
  );
}

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
  // `html` grava em playwright-report/ -- e o caminho que o passo "guardar
  // rastro do Playwright quando falha" do ci.yml sobe como artefato. Sem
  // este reporter o diretorio nunca existe: trace e screenshot ficam presos
  // em test-results/ (outputDir padrao), fora do que o upload le. Lacuna
  // pre-existente (o passo ja apontava para admin-web antes da F49),
  // corrigida junto por estar no mesmo passo do ci.yml.
  reporter: process.env['CI']
    ? [['github'], ['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list']],

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
      // `reuseExistingServer` fica FALSO quando a API precisa apontar para o
      // banco de E2E: reaproveitar um processo que ja estava de pe reaproveita
      // tambem o `DATABASE_URL` dele -- e ai a suite volta a escrever no banco
      // de desenvolvimento, com a configuracao parecendo correta.
      reuseExistingServer: false,
      timeout: 120_000,
      env: { DATABASE_URL: URL_DO_BANCO_E2E },
    },
    {
      command: 'pnpm --filter @arenahub/admin-web start',
      url: `http://localhost:${PORTA_DA_WEB}/login`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
  ],
});
