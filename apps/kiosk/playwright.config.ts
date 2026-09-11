import { defineConfig, devices } from '@playwright/test';

/**
 * E2E do totem -- o aceite da F49 (Slice 4.5).
 *
 * O Playwright NAO carrega `.env` sozinho: ele le este arquivo num processo
 * proprio, que nao herda o `--env-file` de quem o chamou. Sem esta linha as
 * variaveis existem no `.env`, o `pretest:e2e` prepara o banco certo -- e a
 * suite morre em seguida dizendo que a variavel nao existe.
 *
 * `loadEnvFile` e do proprio Node (22+), entao nao entra dependencia nova, e
 * nao sobrescreve variavel ja presente no ambiente: no CI o valor vem do job.
 * O `try` existe porque no CI nao HA `.env`, e `loadEnvFile` lanca quando o
 * arquivo falta -- ausencia nao e erro aqui; falta de variavel e, e quem
 * reclama disso sao as checagens logo abaixo.
 */
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // Sem `.env`: as variaveis vem do ambiente (CI).
}

/**
 * `127.0.0.1`, e NUNCA `localhost`.
 *
 * O totem liga em loopback por decisao de seguranca (`--hostname 127.0.0.1`
 * no `start` -- veja o comentario no `package.json`). O Next entao atende
 * SO no IPv4 de loopback. `localhost` no Windows e em Node recente resolve
 * primeiro para `::1`, onde NAO ha socket ouvindo -- a suite morreria com
 * `ECONNREFUSED` apontando para um servidor que esta de pe.
 */
const HOST = '127.0.0.1';

/**
 * Porta do totem no E2E.
 *
 * NAO e a 3344 (da API, fixa por convencao: se ocupada, o projeto manda
 * falhar, nao trocar) e nao e a 3000 (do admin-web, que costuma estar de pe
 * na mesma maquina). A 3210 esta livre nos dois casos, entao rodar o E2E do
 * totem nao exige derrubar nada.
 */
const PORTA_DO_TOTEM = 3210;
const PORTA_DA_API = 3344;

/**
 * Banco do E2E -- card [INFRA], issue #101.
 *
 * SEM padrao e SEM fallback para `DATABASE_URL`: cair no banco de
 * desenvolvimento em silencio e o defeito que esta checagem existe para
 * impedir. Falta a variavel, a suite para e diz o que falta.
 */
const URL_DO_BANCO_E2E = process.env['E2E_DATABASE_URL'];


if (!URL_DO_BANCO_E2E) {
  throw new Error(
    'E2E_DATABASE_URL nao definida. Copie a linha do `.env.example` para o seu ' +
      '`.env` e ajuste a porta para a do seu Postgres (veja POSTGRES_PORT).',
  );
}

/**
 * O mesmo banco de E2E, pelo role RESTRITO (issue #306).
 *
 * Sem ela a API roda sob o dono, que IGNORA RLS mesmo com `FORCE` -- e a
 * suite passa a nao enxergar defeito de contexto nenhum. Cair no
 * `E2E_DATABASE_URL` quando ausente mantem de pe quem ainda nao criou o role,
 * ao custo de perder essa cobertura; o `.env.example` traz a linha.
 */
const URL_RESTRITA_E2E = process.env['RUNTIME_E2E_DATABASE_URL'] || URL_DO_BANCO_E2E;

/**
 * Credencial HMAC do totem, criada pelo SEED (`dev-totem01`).
 *
 * Sem ela a ponte nao assina, a API recusa toda chamada e TODA identificacao
 * cai na mensagem neutra -- que e a degradacao correta do produto e o pior
 * cenario possivel para um teste: a jornada nunca acontece, e um teste que so
 * verificasse "voltou ao atrator" passaria sem nunca ter havido sessao.
 *
 * Por isso a suite PARA aqui, em vez de rodar e ficar verde por engano.
 */
const KEY_ID = process.env['KIOSK_KEY_ID'];
const SECRET = process.env['KIOSK_SECRET'];

if (!KEY_ID || !SECRET) {
  throw new Error(
    'KIOSK_KEY_ID e KIOSK_SECRET nao definidas. O seed cria a credencial ' +
      '`dev-totem01`; copie as duas linhas do `.env.example` para o seu `.env`. ' +
      'Sem elas a identificacao SEMPRE falha e a jornada nao acontece.',
  );
}

/**
 * A chave de cifra dos segredos simetricos precisa ser a MESMA que o seed
 * usou para gravar a credencial: o seed cifra, a API decifra. Com a chave
 * efemera (o padrao em desenvolvimento) a API gera uma nova a cada arranque e
 * devolve 401 em tudo, sem nada apontando para a causa.
 *
 * O seed PULA a credencial quando ela falta, entao chegar aqui sem a chave
 * significa banco sem credencial -- mesma falha, verificada antes de subir
 * dois servidores para descobri-la.
 */
const CHAVE_DE_CIFRA = process.env['MFA_ENCRYPTION_KEY'];

if (!CHAVE_DE_CIFRA) {
  throw new Error(
    'MFA_ENCRYPTION_KEY nao definida. O seed cifra o segredo do totem com ela ' +
      'e a API precisa da MESMA chave para decifrar -- com chave efemera a ' +
      'credencial gravada pelo seed nunca autentica. Descomente a linha no ' +
      'seu `.env` (veja `.env.example`) e rode `pnpm db:e2e` de novo.',
  );
}

/**
 * Dois processos no `webServer` porque a jornada atravessa os dois: a tela
 * chama a ponte do proprio totem, que assina e repassa para a API. Subir so o
 * front e mockar a API provaria que o front funciona contra um duble -- nao
 * que a fatia funciona.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Serial: os testes compartilham o MESMO aluno semeado, e sessao de totem e
  // por dispositivo. Em paralelo, o encerramento de um mataria o outro.
  workers: 1,
  fullyParallel: false,
  // `test.only` esquecido faria o CI passar rodando um teste so, com o verde
  // parecendo igual.
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  // `html` grava em playwright-report/ -- e o caminho que o passo "guardar
  // rastro do Playwright quando falha" do ci.yml sobe como artefato. Sem
  // este reporter o diretorio nunca existe: trace e screenshot ficam presos
  // em test-results/ (outputDir padrao), fora do que o upload le.
  reporter: process.env['CI']
    ? [['github'], ['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list']],

  use: {
    baseURL: `http://${HOST}:${String(PORTA_DO_TOTEM)}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // `start` (dist compilado), e nao `dev` (tsx): o esbuild por tras do
      // `tsx` NAO implementa `emitDecoratorMetadata`, e sem `design:paramtypes`
      // a injecao por tipo do Nest falha em runtime -- erro que so aparece ao
      // subir o processo, nunca no typecheck.
      command: 'pnpm --filter @arenahub/api start',
      url: `http://${HOST}:${String(PORTA_DA_API)}/health/live`,
      // FALSO: reaproveitar uma API que ja estava de pe reaproveita tambem o
      // `DATABASE_URL` dela -- e ai a suite le o banco de desenvolvimento, que
      // nao tem a credencial do seed, com a configuracao parecendo correta.
      reuseExistingServer: false,
      timeout: 120_000,
      // ROLE RESTRITO LIGADO (issue #306). Antes era `RUNTIME_DATABASE_URL: ''`
      // -- o E2E rodava sob o role DONO, que ignora RLS, e por isso ficava
      // cego a toda uma classe de defeito: os pontos que devolviam lista vazia
      // sob a politica passavam verdes aqui. Apontar para o banco de E2E pelo
      // role restrito e o que torna a suite capaz de ver o que a #302 e a #306
      // corrigiram.
      //
      // Continua sendo a variavel do banco de E2E, nunca a do `.env` (que
      // aponta para DESENVOLVIMENTO): o processo herda o ambiente de quem
      // chamou, e a do `.env` venceria a linha ao lado -- a suite escreveria
      // no banco errado com a configuracao parecendo correta.
      env: {
        DATABASE_URL: URL_DO_BANCO_E2E,
        MFA_ENCRYPTION_KEY: CHAVE_DE_CIFRA,
        RUNTIME_DATABASE_URL: URL_RESTRITA_E2E,
      },
    },
    {
      // `-p` explicito: o `start` do pacote ja fixa `--hostname 127.0.0.1`, e
      // a porta padrao do Next (3000) e a do admin-web.
      command: `pnpm --filter @arenahub/kiosk start -p ${String(PORTA_DO_TOTEM)}`,
      url: `http://${HOST}:${String(PORTA_DO_TOTEM)}`,
      // Tambem FALSO, e pelo mesmo motivo da API: um totem ja de pe teria as
      // proprias `KIOSK_*` (ou nenhuma), e a suite ficaria vermelha ou -- pior
      // -- verde contra um servidor que nao e o que se quer testar.
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        KIOSK_KEY_ID: KEY_ID,
        KIOSK_SECRET: SECRET,
        API_INTERNAL_URL: `http://${HOST}:${String(PORTA_DA_API)}`,
      },
    },
  ],
});
