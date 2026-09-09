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
   * O UPLOAD DE ARQUIVO NÃO ENTRA NESTA JORNADA, e a omissão é decisão, não
   * esquecimento.
   *
   * O runner do CI sobe **só Postgres** — não há MinIO —, e o upload grava no
   * bucket de verdade: aqui ele morre com `ECONNREFUSED 127.0.0.1:9000`. Na
   * integração isso se resolve trocando a porta de storage por um dublê; no
   * E2E não, porque a API roda como processo separado e o teste não alcança o
   * container de injeção dela.
   *
   * O que o upload prova está coberto onde é estável: a recusa do SVG com
   * script tem **10 testes de unidade** (`identidade-visual.spec.ts`) e a
   * gravação tem **9 de integração** (`platform-identidade-visual.int-spec.ts`,
   * incluindo "recusa e não grava nada" e "apaga o arquivo anterior").
   *
   * O que SÓ esta jornada prova é o que segue abaixo: a tela `/{slug}/login`,
   * sem sessão, renderizando a marca que o Super Admin acabou de configurar.
   * Por isso ela segue sem o logo — `temLogo` é falso, e o hero cai no
   * wordmark, que é exatamente o caminho de quem ainda não enviou arquivo.
   *
   * Quando o CI ganhar MinIO, o upload volta para cá em três linhas.
   */

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
  // SEM LOGO nesta jornada (ver a nota acima sobre o CI sem MinIO): o hero cai
  // no wordmark, que é o caminho de quem ainda não enviou arquivo.
  await expect(telaDeLogin.getByTestId('logo-do-tenant')).toBeHidden();
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

/**
 * A jornada do contrato — F63, issue #286.
 *
 * O dono do SaaS cadastra um plano, abre um contrato com a academia e vê os
 * valores acordados na tabela. É o fio que teste de unidade e de integração
 * não veem: o formulário troca de campos conforme o modelo, e a Server Action
 * converte reais para centavos entre a tela e a API.
 */
const REFRESH_DE_PLATAFORMA_DO_CONTRATO = 'refresh-de-bancada-do-super-admin-e2e-contrato';

const CONTRATO = {
  slug: `contrato-e2e-${sufixo}`,
  displayName: `Contrato E2E ${sufixo}`,
  legalName: `Contrato E2E ${sufixo} LTDA`,
  cnpj: '12.345.678/0001-99',
  responsavelNome: 'Responsavel de Contrato',
  responsavelEmail: `contrato-e2e-${sufixo}@exemplo.test`,
  plano: `Plano E2E ${sufixo}`,
};

test('o dono do SaaS cadastra plano e abre contrato com a academia', async ({ page, context }) => {
  await context.addCookies([
    {
      name: 'arenahub_refresh',
      value: REFRESH_DE_PLATAFORMA_DO_CONTRATO,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);

  // --- o plano SaaS, no modelo por aluno ----------------------------------
  await page.goto('/platform/planos');
  await expect(page).not.toHaveURL(/\/login/);

  await page.getByTestId('campo-nome-do-plano').fill(CONTRATO.plano);
  /*
   * MODELO POR ALUNO: os campos de preço por ativo e por inativo aparecem, e o
   * de valor fixo NÃO existe na tela. Não é `disabled` -- é ausente, e é isso
   * que o teste afirma logo abaixo.
   */
  await page.getByTestId('campo-modelo-do-plano').selectOption('PER_STUDENT');
  await expect(page.getByTestId('campo-preco-fixo')).toBeHidden();

  await page.getByTestId('campo-preco-do-ativo').fill('7,50');
  // ZERO no inativo: é o caso que o ADR-052 §6 previu -- cobrar lead
  // desestimula cadastrar lead, e o preço é negociado por contrato.
  await page.getByTestId('campo-preco-do-inativo').fill('0');
  await page.getByTestId('confirmar-plano').click();
  await expect(page.getByTestId('plano-salvo')).toBeVisible();

  /*
   * A CONVERSÃO PARA CENTAVOS SÓ SE VÊ AQUI. `7,50` digitado tem de virar 750
   * na API e voltar formatado na tabela; um erro de fator de cem passaria por
   * todos os testes de unidade da action e apareceria só na fatura.
   */
  const linhaDoPlano = page.getByRole('row').filter({ hasText: CONTRATO.plano });
  await expect(linhaDoPlano).toContainText('R$ 7,50');
  await expect(linhaDoPlano).toContainText('R$ 0,00');

  // --- trocar para fixo esconde os campos por aluno ------------------------
  await page.getByTestId('campo-modelo-do-plano').selectOption('FIXED_MONTHLY');
  await expect(page.getByTestId('campo-preco-do-ativo')).toBeHidden();
  await expect(page.getByTestId('campo-preco-fixo')).toBeVisible();
  await page.getByTestId('campo-modelo-do-plano').selectOption('PER_STUDENT');

  // --- a academia ---------------------------------------------------------
  await page.goto('/platform/novo');
  await page.getByTestId('campo-nome-da-academia').fill(CONTRATO.displayName);
  await page.getByTestId('campo-razao-da-academia').fill(CONTRATO.legalName);
  await page.getByTestId('campo-cnpj-da-academia').fill(CONTRATO.cnpj);
  await page.getByTestId('campo-slug-da-academia').fill(CONTRATO.slug);
  await page.getByTestId('campo-nome-do-responsavel').fill(CONTRATO.responsavelNome);
  await page.getByTestId('campo-email-do-responsavel').fill(CONTRATO.responsavelEmail);
  await page.getByTestId('campo-codigo-da-unidade').fill('MATRIZ');
  await page.getByTestId('campo-nome-da-unidade').fill('Unidade Matriz');
  await page.getByTestId('confirmar-academia').click();
  await expect(page.getByTestId('academia-criada')).toBeVisible();

  // --- o contrato, alcançado pelo detalhe da academia ----------------------
  await page.goto('/platform');
  await page
    .getByRole('row')
    .filter({ hasText: CONTRATO.displayName })
    .getByTestId('abrir-academia')
    .click();

  await page.getByTestId('ver-contratos').click();
  await expect(page.getByTestId('contratos-vazio')).toBeVisible();

  await page.getByTestId('campo-plano-do-contrato').selectOption({ label: `${CONTRATO.plano} (por aluno)` });
  /*
   * PLANO POR ALUNO NÃO PEDE ÍNDICE: o preço acompanha o catálogo do próximo
   * contrato, não um reajuste anual. Os campos de reajuste somem da tela, e a
   * data-base vai escondida com o valor do início.
   */
  await expect(page.getByTestId('campo-indice-do-contrato')).toBeHidden();

  await page.getByTestId('campo-inicio-do-contrato').fill('2026-03-01');
  await page.getByTestId('campo-dia-de-emissao').fill('1');
  await page.getByTestId('campo-carencia-do-contrato').fill('15');
  await page.getByTestId('confirmar-contrato').click();
  await expect(page.getByTestId('contrato-aberto')).toBeVisible();

  /*
   * OS VALORES DA TABELA SÃO OS DO CONTRATO, copiados do plano na abertura.
   * O contrato nasce em RASCUNHO -- fechar é um segundo ato, e é ele que gera
   * o PDF.
   */
  const linhaDoContrato = page.getByRole('row').filter({ hasText: '01/03/2026' });
  await expect(linhaDoContrato).toContainText('R$ 7,50');
  await expect(linhaDoContrato).toContainText('Rascunho');
  await expect(linhaDoContrato.getByTestId('fechar-contrato')).toBeVisible();

  /*
   * O FECHAMENTO NÃO ENTRA NESTA JORNADA, e a omissão é decisão, não
   * esquecimento -- mesma razão do upload de marca acima.
   *
   * `activate` GRAVA O PDF no bucket, e o runner do CI sobe só Postgres: aqui
   * a chamada morreria com `ECONNREFUSED 127.0.0.1:9000`, por falta de MinIO e
   * não por defeito. Na integração isso se resolve trocando a porta de storage
   * por um dublê; no E2E não, porque a API roda como processo separado.
   *
   * O que o fechamento prova está coberto onde é estável: 18 testes de
   * integração (`platform-contrato.int-spec.ts`), entre eles "o PDF reproduz o
   * valor do contrato, e não o do plano atual" e "o BANCO recusa contrato ativo
   * sem PDF".
   *
   * Quando o CI ganhar MinIO, o fechamento volta para cá em três linhas.
   */
});
