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
 * responde um desafio de MFA, nunca uma sessão. A TELA DO DESAFIO PASSOU A
 * EXISTIR (issue #293) — o painel tem `/login/2fa` e `/login/configurar-2fa`,
 * e o Super Admin entra por elas. O que continua sem servir é atravessá-las
 * DAQUI: gerar o TOTP no teste exigiria portar o algoritmo para o lado do
 * painel, e o código vira a cada 30 s — um teste que falha quando a janela
 * troca no meio da digitação acusa defeito que não existe.
 *
 * O desafio está coberto onde é estável: nove testes de integração
 * (`platform-mfa-de-plataforma.int-spec.ts`) e treze de unidade
 * (`app/actions/auth.test.ts`). Decisão do PI, mantida: o E2E não passa pelo
 * desafio.
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

/**
 * Identidade visual e login por slug — F62, issue #285.
 *
 * Jornada separada da anterior de propósito: aquela costura a criação e a
 * elevação, e o refresh de plataforma é de USO ÚNICO (ver a nota no topo).
 * Emendar a marca no mesmo fio faria uma falha no upload esconder o defeito da
 * elevação, e vice-versa.
 *
 * O que só o E2E prova aqui: a tela `/{slug}/login` renderiza a marca que o
 * Super Admin acabou de configurar. Unidade e integração cobrem o sanitizador
 * e a rota; nenhum dos dois abre a página que o time da academia vê.
 */
/**
 * A SEGUNDA sessao semeada (`seed.ts`), e nao a mesma da jornada acima: o
 * refresh e de uso unico e rotaciona ao ser apresentado. Duas jornadas
 * partindo do mesmo token fariam a segunda falhar por deteccao de reuso --
 * erro de sessao no lugar do defeito que o teste procura.
 */
const REFRESH_DE_PLATAFORMA_DA_MARCA = 'refresh-de-bancada-do-super-admin-e2e-marca';

const MARCA = {
  slug: `marca-e2e-${sufixo}`,
  displayName: `Marca E2E ${sufixo}`,
  legalName: `Marca E2E ${sufixo} LTDA`,
  cnpj: '12.345.678/0001-99',
  responsavelNome: 'Responsavel de Marca',
  responsavelEmail: `marca-e2e-${sufixo}@exemplo.test`,
  missao: 'Treinar todo mundo que entra aqui.',
  diferenciais: 'Quadra de areia\nBox de cross',
};

const SVG_LIMPO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24"><rect width="48" height="24" fill="#0a7"/></svg>',
  'utf-8',
);

/** O payload que a fatia existe para barrar. */
const SVG_COM_SCRIPT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("https://mau.example")</script></svg>',
  'utf-8',
);

test('a marca da academia aparece na tela de login por slug', async ({ page, context }) => {
  await context.addCookies([
    {
      name: 'arenahub_refresh',
      value: REFRESH_DE_PLATAFORMA_DA_MARCA,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);

  await page.goto('/platform/novo');
  await expect(page).not.toHaveURL(/\/login/);

  await page.getByTestId('campo-nome-da-academia').fill(MARCA.displayName);
  await page.getByTestId('campo-razao-da-academia').fill(MARCA.legalName);
  await page.getByTestId('campo-cnpj-da-academia').fill(MARCA.cnpj);
  await page.getByTestId('campo-slug-da-academia').fill(MARCA.slug);
  await page.getByTestId('campo-nome-do-responsavel').fill(MARCA.responsavelNome);
  await page.getByTestId('campo-email-do-responsavel').fill(MARCA.responsavelEmail);
  await page.getByTestId('campo-codigo-da-unidade').fill('MATRIZ');
  await page.getByTestId('campo-nome-da-unidade').fill('Unidade Matriz');
  await page.getByTestId('confirmar-academia').click();
  await expect(page.getByTestId('academia-criada')).toBeVisible();

  await page.goto('/platform');
  await page
    .getByRole('row')
    .filter({ hasText: MARCA.displayName })
    .getByTestId('abrir-academia')
    .click();

  // --- missão e diferenciais, pelo formulário de cadastro ------------------
  await page.getByTestId('campo-missao-da-academia').fill(MARCA.missao);
  await page.getByTestId('campo-diferenciais-da-academia').fill(MARCA.diferenciais);
  await page.getByTestId('salvar-academia').click();
  await expect(page.getByTestId('academia-salva')).toBeVisible();

  /*
   * O SVG COM SCRIPT É RECUSADO NA TELA -- o terceiro aceite da issue #285.
   *
   * Aqui, e não só no teste de integração: o que importa para quem cadastra é
   * que a recusa CHEGA como mensagem legível, e não como erro genérico que
   * mande tentar de novo o mesmo arquivo.
   */
  await page.getByTestId('campo-de-logo').setInputFiles({
    name: 'logo-malicioso.svg',
    mimeType: 'image/svg+xml',
    buffer: SVG_COM_SCRIPT,
  });
  await page.getByRole('button', { name: /Enviar arquivo/ }).first().click();

  /*
   * A FRASE, e nao só um estado de erro: quem exportou o vetor do Figma não
   * sabe que ele saiu com script embutido, e "arquivo inválido" mandaria a
   * pessoa reenviar o mesmo arquivo. O texto é o que faz a recusa ser
   * acionável.
   */
  await expect(page.getByText(/script embutido/i)).toBeVisible();

  /*
   * E O ARQUIVO NÃO ENTROU: sem esta asserção, o teste passaria com a API
   * gravando o SVG malicioso e mostrando o erro depois -- o payload ficaria no
   * bucket, servido pela rota pública.
   */
  await expect(page.getByTestId('previa-de-logo')).toBeHidden();

  // --- o SVG limpo entra ---------------------------------------------------
  await page.getByTestId('campo-de-logo').setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: SVG_LIMPO,
  });
  await page.getByRole('button', { name: /Enviar arquivo|Trocar arquivo/ }).first().click();
  await expect(page.getByTestId('logo-enviado')).toBeVisible();

  // --- a tela de login da academia mostra tudo ----------------------------
  //
  // SEM SESSÃO: o contexto novo é o que prova que a rota é pública. Reusar a
  // página logada mostraria a marca por um caminho que quem vai fazer login
  // nunca percorre.
  const anonimo = await page.context().browser()!.newContext();
  const telaDeLogin = await anonimo.newPage();

  await telaDeLogin.goto(`/${MARCA.slug}/login`);

  await expect(telaDeLogin.getByTestId('nome-do-tenant')).toHaveText(MARCA.displayName);
  await expect(telaDeLogin.getByTestId('missao-do-tenant')).toHaveText(MARCA.missao);
  await expect(telaDeLogin.getByTestId('diferenciais-do-tenant')).toContainText('Quadra de areia');
  await expect(telaDeLogin.getByTestId('logo-do-tenant')).toBeVisible();
  await expect(telaDeLogin).toHaveTitle(new RegExp(MARCA.displayName));

  /*
   * SLUG INEXISTENTE CAI NA MARCA ARENAHUB, sem 404 e sem dizer que não
   * existe. É o aceite da issue: o status e o conteúdo desta tela não podem
   * revelar quais academias são clientes.
   */
  await telaDeLogin.goto(`/academia-que-nunca-existiu-${sufixo}/login`);
  await expect(telaDeLogin.getByRole('heading', { name: 'Entrar no painel' })).toBeVisible();
  await expect(telaDeLogin.getByTestId('nome-do-tenant')).toBeHidden();

  await anonimo.close();
});
