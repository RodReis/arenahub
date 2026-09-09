import { expect, test } from '@playwright/test';

/**
 * A jornada do dono do SaaS — F61, issue #284.
 *
 * Abrir `/platform`, cadastrar uma academia pela tela, entrar nela como
 * suporte com justificativa, ver a faixa que avisa disso, e sair. É a fatia
 * inteira num fio só: cada passo depende do cookie que o anterior deixou, e é
 * exatamente essa costura que teste de unidade e de integração não veem.
 */

/**
 * COMO A SESSÃO DE SUPER ADMIN É ESTABELECIDA — e por que não é pelo login.
 *
 * O login do dono do SaaS exige segundo fator (INV-007): `POST /auth/login`
 * responde um desafio de MFA, nunca uma sessão. O painel ainda não tem tela
 * para esse desafio, então não há formulário por onde este teste possa entrar.
 * Gerar o TOTP aqui também não serve — o algoritmo mora na API, o código vira
 * a cada 30 s, e o passo já está coberto por três testes de integração
 * (`platform-mfa-de-plataforma.int-spec.ts`). Decisão do PI: o E2E não passa
 * pelo desafio.
 *
 * O QUE ELE FAZ NO LUGAR é apresentar o cookie de refresh de uma sessão de
 * plataforma que o seed criou, e deixar o PRODUTO abrir a sessão: o `proxy.ts`
 * vê refresh sem acesso, chama `POST /auth/refresh`, e a **API** emite o token
 * de acesso — assinado com a chave dela, para aquela sessão. Nada é forjado
 * aqui: o teste não assina token, não escreve no banco e não conhece claim
 * nenhuma. É o mesmo caminho que renova a sessão de qualquer usuário do
 * painel, todo dia.
 *
 * O VALOR VEM DO SEED (`packages/database/prisma/seed.ts`), que grava o
 * SHA-256 dele na sessão — o refresh do ArenaHub é opaco por construção, e o
 * banco só guarda o hash.
 */
const REFRESH_DE_PLATAFORMA = 'refresh-de-bancada-do-super-admin-e2e';

/**
 * USO ÚNICO, e o teto é do produto: o refresh ROTACIONA ao ser usado, e
 * reapresentar um já rotacionado derruba a família de sessões inteira
 * (detecção de reuso, `auth.service.ts`). O `pretest:e2e` repõe a linha a cada
 * execução da suíte, então cada RUN tem um token vivo — mas uma segunda
 * tentativa dentro do mesmo run encontraria o token queimado e falharia por um
 * motivo que não é o defeito.
 *
 * Por isso, retry zero AQUI: falha vira falha, não um erro de sessão
 * enganoso. Se um dia esta jornada ficar mesmo instável, o caminho é o seed
 * semear uma sessão por tentativa — não reativar o retry por cima do token
 * queimado.
 */
test.describe.configure({ retries: 0 });

/** Único por execução: a suíte não limpa o que cria, e `slug` é permanente. */
const sufixo = String(Date.now()).slice(-9);
const ACADEMIA = {
  slug: `academia-e2e-${sufixo}`,
  displayName: `Academia E2E ${sufixo}`,
  legalName: `Academia E2E ${sufixo} LTDA`,
  // CNPJ falso, com máscara de propósito: é assim que se digita, e a action
  // tem de tirar os separadores antes de mandar para a API.
  cnpj: '12.345.678/0001-99',
  responsavelNome: 'Responsavel de E2E',
  responsavelEmail: `responsavel-e2e-${sufixo}@exemplo.test`,
  unidadeCode: 'MATRIZ',
  unidadeName: 'Unidade Matriz',
};

test('o dono do SaaS cria a academia e entra nela como suporte', async ({ page, context }) => {
  await context.addCookies([
    {
      name: 'arenahub_refresh',
      value: REFRESH_DE_PLATAFORMA,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);

  // A LISTA ABRE: o `proxy` renovou, e a API aceitou o token numa rota que
  // recusa quem não é dono do SaaS. Cair no login aqui significaria que a
  // sessão de plataforma não se estabeleceu.
  await page.goto('/platform');
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByTestId('usuario-logado')).toHaveText('dono@arenahub.test');

  await page.getByTestId('nova-academia').click();

  await page.getByTestId('campo-nome-da-academia').fill(ACADEMIA.displayName);
  await page.getByTestId('campo-razao-da-academia').fill(ACADEMIA.legalName);
  await page.getByTestId('campo-cnpj-da-academia').fill(ACADEMIA.cnpj);
  await page.getByTestId('campo-slug-da-academia').fill(ACADEMIA.slug);
  await page.getByTestId('campo-nome-do-responsavel').fill(ACADEMIA.responsavelNome);
  await page.getByTestId('campo-email-do-responsavel').fill(ACADEMIA.responsavelEmail);
  await page.getByTestId('campo-codigo-da-unidade').fill(ACADEMIA.unidadeCode);
  await page.getByTestId('campo-nome-da-unidade').fill(ACADEMIA.unidadeName);
  await page.getByTestId('confirmar-academia').click();

  await expect(page.getByTestId('academia-criada')).toBeVisible();

  /*
   * A ACADEMIA EXISTE quando aparece na lista. Confirmar só a tela de sucesso
   * provaria que o formulário mudou de estado, não que a academia foi criada.
   */
  await page.goto('/platform');
  const linha = page.getByRole('row').filter({ hasText: ACADEMIA.displayName });
  await expect(linha).toBeVisible();
  await linha.getByTestId('abrir-academia').click();

  await page.getByTestId('elevar').click();
  await page
    .getByTestId('justificativa')
    .fill('Suporte combinado com o responsavel da academia por telefone');
  await page.getByTestId('confirmar-elevacao').click();

  /*
   * A ELEVAÇÃO LEVA AO PAINEL DA ACADEMIA -- e a faixa vai junto. Ela é o
   * aviso de que a tela pertence a outra pessoa: sem ela, quem opera elevado
   * age achando que está na própria casa.
   */
  await expect(page).toHaveURL(/\/dashboard/);
  const faixa = page.getByTestId('faixa-de-suporte');
  await expect(faixa).toBeVisible();
  await expect(faixa).toContainText(ACADEMIA.displayName);

  await page.getByTestId('sair-do-suporte').click();

  // De volta à plataforma, e a faixa some -- porque a sessão não tem mais
  // tenant, não porque alguém escondeu o aviso.
  await expect(page).toHaveURL(/\/platform/);
  await expect(page.getByTestId('faixa-de-suporte')).toBeHidden();
});
