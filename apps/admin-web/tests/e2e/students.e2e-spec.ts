import { expect, test } from '@playwright/test';

import { cadastrarAluno, preencherCadastro } from './cadastro-de-aluno';
import { criarPlano } from './cadastro-de-plano';

/**
 * Jornada de `M1-AC-002` e `M1-AC-003`: a recepção trabalha sem `curl`.
 *
 * O aceite da Slice 1.2 é literal — "a recepção cadastra aluno, atribui plano
 * e visualiza exatamente quando e onde o acesso é válido". Enquanto isso só
 * acontecia por linha de comando, o aceite não fechava; estes testes são a
 * prova de que agora fecha pela interface.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

async function entrar(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Nome único por execução.
 *
 * Os testes rodam em série contra o MESMO banco semeado, sem limpeza entre
 * arquivos. Nome fixo faria a segunda execução encontrar o aluno da primeira e
 * o teste passaria por engano -- ou falharia na checagem de duplicata.
 */
function nomeUnico(prefixo: string): string {
  return `${prefixo} ${Date.now()}`;
}

test.describe('cadastro de aluno', () => {
  test('sem sessão, a lista manda para o login', async ({ page }) => {
    await page.goto('/students');

    await expect(page).toHaveURL(/\/login/);
  });

  test('a recepção cadastra um aluno e recebe a matrícula na hora', async ({ page }) => {
    await entrar(page);

    await cadastrarAluno(page, {
      nome: nomeUnico('Aluna de Bancada'),
      nascimento: '1995-03-14',
      telefone: '41999990000',
    });

    // A matrícula é gerada pelo servidor e NÃO deriva de CPF (INV-009/011).
    await expect(page.getByTestId('matricula-gerada')).toContainText(/^AP-\d{4}-\d{8}$/);
  });

  /*
   * ESTE TESTE GUARDAVA A DECISAO DE 18/08 ("nome, nascimento e unidade são
   * os ÚNICOS obrigatórios"). O ADR-043 Decisão 3 (23/08/2026) reverteu isso:
   * o antifraude do checkout de cartão bloqueia cobrança sem CPF, e o PI
   * decidiu exigi-lo no cadastro. O teste agora guarda a decisão NOVA -- não
   * foi apagado porque o histórico de por que a regra mudou tem valor.
   */
  test('recusa cadastro sem CPF (ADR-043 Decisão 3)', async ({ page }) => {
    await entrar(page);

    // CPF em branco de propósito (`cpf: ''`, não omitido -- omitido usaria o
    // default gerado pelo helper) -- é exatamente o caso que a validação nova
    // precisa barrar. `preencherCadastro`, não `cadastrarAluno`: este teste
    // não espera sucesso.
    await preencherCadastro(page, {
      nome: nomeUnico('Sem Documento'),
      nascimento: '2001-07-02',
      cpf: '',
    });

    await expect(page.getByTestId('erro-do-cadastro')).toBeVisible();
  });

  test('nome curto demais é recusado sem perder o que foi digitado', async ({ page }) => {
    await entrar(page);

    await preencherCadastro(page, { nome: 'A', nascimento: '1990-01-01' });

    await expect(page.getByTestId('erro-do-cadastro')).toBeVisible();

    // O que foi digitado continua lá. Com um campo isso era conforto; com
    // vinte e dois em quatro passos, é a diferença entre usar o sistema e
    // voltar para o papel.
    await page.getByTestId('ir-para-passo-1').click();
    await expect(page.getByTestId('campo-birthDate')).toHaveValue('1990-01-01');
  });

  test('formulário vazio não é enviado -- e a tela leva ao campo que falta', async ({ page }) => {
    await entrar(page);
    await page.goto('/students/novo');

    // Vai direto ao último passo sem preencher nada, que é o caminho que a
    // navegação por trilha permite.
    await page.getByTestId('ir-para-passo-4').click();
    await page.getByTestId('confirmar-cadastro').click();

    // ANTES DA CORREÇÃO ISTO NÃO ACONTECIA: o `required` do HTML não vale
    // para campo dentro de contêiner `hidden`, então o navegador dava o
    // formulário vazio por válido, o envio seguia e a recepção ficava
    // olhando para um botão que não fazia nada. Medido no navegador:
    // `form.checkValidity()` devolvia `true` com os 22 campos vazios.
    await expect(page.getByTestId('erro-do-cadastro')).toContainText(/nome completo/i);

    // E não basta avisar: a mensagem tem de vir junto com o passo onde o
    // campo mora, senão manda procurar em quatro telas.
    await expect(page.getByTestId('campo-fullName')).toBeVisible();

    // Nada foi cadastrado.
    await expect(page.getByTestId('aluno-cadastrado')).toHaveCount(0);
  });

  test('falta só a unidade: a tela leva ao passo administrativo', async ({ page }) => {
    await entrar(page);
    await page.goto('/students/novo');

    await page.getByTestId('campo-fullName').fill(nomeUnico('Sem Unidade'));
    await page.getByTestId('campo-birthDate').fill('1990-01-01');
    // CPF obrigatório desde o ADR-043 Decisão 3 -- sem ele, o erro pararia
    // no passo 1 e nunca chegaria à checagem de unidade que este teste prova.
    await page.getByTestId('campo-cpf').fill('111.444.777-35');

    await page.getByTestId('ir-para-passo-4').click();
    await page.getByTestId('confirmar-cadastro').click();

    await expect(page.getByTestId('erro-do-cadastro')).toContainText(/unidade/i);
    // Passo 3 é onde a unidade mora.
    await expect(page.getByTestId('campo-gymUnitId')).toBeVisible();
  });

  test('o rascunho sobrevive à navegação entre os quatro passos', async ({ page }) => {
    await entrar(page);
    await page.goto('/students/novo');

    const nome = nomeUnico('Rascunho Preservado');

    await page.getByTestId('campo-fullName').fill(nome);
    await page.getByTestId('campo-cpf').fill('11144477735');

    // Preenche o passo 2 e volta ao 1: React que desmontasse os campos
    // escondidos descartaria tudo isto em silêncio.
    await page.getByTestId('ir-para-passo-2').click();
    await page.getByTestId('campo-cep').fill('80010000');
    await page.getByTestId('campo-logradouro').fill('Rua das Flores');

    await page.getByTestId('ir-para-passo-1').click();
    await expect(page.getByTestId('campo-fullName')).toHaveValue(nome);
    // A máscara roda na digitação, não no envio.
    await expect(page.getByTestId('campo-cpf')).toHaveValue('111.444.777-35');

    await page.getByTestId('ir-para-passo-2').click();
    await expect(page.getByTestId('campo-cep')).toHaveValue('80010-000');
    await expect(page.getByTestId('campo-logradouro')).toHaveValue('Rua das Flores');
  });

  test('endereço e contato de emergência atravessam o cadastro', async ({ page }) => {
    await entrar(page);
    await page.goto('/students/novo');

    const nome = nomeUnico('Com Endereco');

    await page.getByTestId('campo-fullName').fill(nome);
    await page.getByTestId('campo-birthDate').fill('1991-04-12');
    // CPF obrigatório desde o ADR-043 Decisão 3.
    await page.getByTestId('campo-cpf').fill('111.444.777-35');

    await page.getByTestId('ir-para-passo-2').click();
    await page.getByTestId('campo-cep').fill('80010000');
    await page.getByTestId('campo-logradouro').fill('Rua das Flores');
    await page.getByTestId('campo-numero').fill('123');
    await page.getByTestId('campo-cidade').fill('Curitiba');
    // `<select>` nativo desde a issue #231: um `selectOption` no lugar do par
    // abrir-menu + clicar-na-opcao que o combobox de `<div>` exigia.
    await page.getByTestId('campo-uf').selectOption('PR');

    await page.getByTestId('campo-emergenciaNome').fill('Maria Silva');
    await page.getByTestId('campo-emergenciaParentesco').fill('mae');
    await page.getByTestId('campo-emergenciaTelefone').fill('41988881111');

    await page.getByTestId('ir-para-passo-3').click();
    // `index: 1` porque a `<option>` de indice 0 e o placeholder ("Selecione a
    // unidade") -- `<select>` nativo nao tem atributo proprio para isso.
    await page.getByTestId('campo-gymUnitId').selectOption({ index: 1 });

    await page.getByTestId('ir-para-passo-4').click();
    await page.getByTestId('confirmar-cadastro').click();

    // `student_addresses` existia desde a F7 e nenhuma tela a escrevia nem a
    // lia. Este teste é a prova de que ela deixou de ser tabela morta: o
    // cadastro conclui COM endereço, em vez de ser recusado por causa dele.
    await expect(page.getByTestId('aluno-cadastrado')).toBeVisible();

    await page.getByTestId('abrir-ficha').click();
    await expect(page.getByRole('heading', { name: nome })).toBeVisible();
  });
});

test.describe('busca de aluno', () => {
  test('encontra pelo nome e leva à ficha', async ({ page }) => {
    await entrar(page);
    const nome = nomeUnico('Busca Por Nome');

    await cadastrarAluno(page, { nome, nascimento: '1988-11-30' });

    await page.goto('/students');
    // Busca automática -- issue #118: sem botão "Filtrar", o campo dispara
    // sozinho 300ms depois de parar de digitar (3+ caracteres). Espera pela
    // troca de URL em vez de um clique que não existe mais.
    const urlAntes = page.url();
    await page.getByLabel('Buscar por nome, matrícula ou contato').fill(nome);
    await page.waitForFunction((anterior) => window.location.href !== anterior, urlAntes);

    await expect(page.getByTestId('tabela-de-alunos')).toBeVisible();
    await page.getByRole('link', { name: nome }).click();

    await expect(page.getByRole('heading', { name: nome })).toBeVisible();
    await expect(page.getByTestId('matricula')).toContainText(/^AP-/);
  });

  /*
   * O TOTAL do "20 de N" -- o denominador acompanha o FILTRO.
   *
   * Só E2E prova isto ponta a ponta: o número sai da API num cabeçalho
   * (`X-Total-Count`), atravessa o `chamarApi` e chega ao rodapé do
   * `DataTable`. Teste de componente cobre a formatação; teste de integração
   * cobre a contagem; nenhum dos dois cobre a travessia.
   */
  test('o rodapé diz de quantos alunos a página é uma fatia', async ({ page }) => {
    await entrar(page);
    await page.goto('/students');

    const rodape = page.getByRole('navigation', { name: 'Paginação' });

    // "20 de 1.968" -- e nunca o texto antigo, que não dava noção de escala.
    await expect(rodape).toContainText(/\d+ de [\d.]+/);
    await expect(rodape).not.toContainText('itens carregados');
  });

  /*
   * A TRAVESSIA -- issue #263. Nenhum teste percorria a paginação inteira, e
   * foi por isso que dois defeitos conviveram na tela:
   *
   *   1. o `useEffect` do filtro rodava na MONTAGEM, apagava o `cursor` e
   *      devolvia quem clicou em "Próximos" para a página 1 -- sozinho,
   *      300 ms depois de a página 2 carregar;
   *   2. não havia link nenhum de volta: a paginação era só de ida.
   *
   * Teste de componente não pega nenhum dos dois, porque os dois só existem
   * na travessia real entre duas páginas servidas.
   */
  test('o cursor na URL SOBREVIVE -- a lista não volta sozinha para a primeira página', async ({
    page,
  }) => {
    await entrar(page);

    /*
     * ENTRA DIRETO NUMA URL COM CURSOR, em vez de clicar em "Próximos".
     *
     * O seed de E2E tem 18 alunos e a página mostra 20, então não existe
     * segunda página aqui para clicar -- e encher o banco com 20 cadastros
     * só para produzir o link seria um teste lento que prova o mesmo. O que
     * o defeito exigia era CHEGAR numa URL com `cursor` e ela permanecer:
     * o `useEffect` do filtro rodava na montagem, apagava o parâmetro e
     * `router.replace` devolvia a pessoa para a primeira página.
     *
     * O cursor aponta para o primeiro aluno da lista; com `skip: 1`, a
     * tabela vem vazia ou curta -- e isso não importa. O que se afirma aqui
     * é que a URL não se reescreve sozinha.
     */
    await page.goto('/students');

    const primeiraLinha = page.getByTestId('tabela-de-alunos').locator('tbody tr').first();
    const idDoPrimeiro = await primeiraLinha.getAttribute('data-testid');
    const cursor = (idDoPrimeiro ?? '').replace('aluno-', '');

    expect(cursor).not.toBe('');

    await page.goto(`/students?cursor=${cursor}`);
    await expect(page).toHaveURL(/cursor=/);

    /*
     * A ESPERA É O TESTE. O defeito acontecia 300 ms DEPOIS da montagem, via
     * `router.replace`: a página carregava certa e só então voltava. Sem
     * esperar mais que o atraso do debounce, o teste passaria com o bug vivo.
     */
    await page.waitForTimeout(1200);

    await expect(page).toHaveURL(/cursor=/);
  });

  /*
   * O denominador muda com o filtro, e é essa a razão de ele existir: um
   * total fixo mentiria assim que alguém filtrasse.
   */
  test('o total encolhe quando o filtro encolhe a lista', async ({ page }) => {
    await entrar(page);

    const totalDe = async (url: string): Promise<number> => {
      await page.goto(url);
      const texto = await page.getByRole('navigation', { name: 'Paginação' }).innerText();
      const achado = /de ([\d.]+)/.exec(texto);

      return Number((achado?.[1] ?? '0').replace(/\./g, ''));
    };

    const todos = await totalDe('/students');
    const ativos = await totalDe('/students?status=ACTIVE');

    expect(ativos).toBeGreaterThan(0);
    expect(ativos).toBeLessThan(todos);
  });

  test('busca sem resultado explica o próximo passo', async ({ page }) => {
    await entrar(page);
    await page.goto('/students?q=nome-que-nao-existe-em-lugar-nenhum');

    // Tabela vazia deixaria o operador sem saber se errou a grafia ou se o
    // aluno não existe.
    await expect(page.getByTestId('sem-alunos')).toContainText(/grafia|cadastre/i);
  });

});

test.describe('plano e direito de acesso', () => {
  test('a recepção cria um plano com janela de horário', async ({ page }) => {
    await entrar(page);

    const nome = nomeUnico('Plano de Bancada');

    await criarPlano(page, nome);
  });

  /**
   * "ACESSO AGORA" SAIU DA FICHA em 24/08/2026, por decisao do PI: a
   * pergunta "essa pessoa entra agora?" e feita olhando a LISTA, com o aluno
   * parado na porta -- nao depois de abrir o cadastro. A situacao ja era
   * coluna la, e a liberacao manual virou icone de linha.
   *
   * O que a ficha continua respondendo, e o que este teste passa a cobrir, e
   * o DETALHE: quais direitos existem, com qual janela.
   */
  test('a ficha mostra que o aluno novo ainda nao tem direito de acesso', async ({ page }) => {
    await entrar(page);
    await cadastrarAluno(page, { nome: nomeUnico('Ficha Sem Plano'), nascimento: '1993-05-21' });
    await page.getByTestId('abrir-ficha').click();

    // Os direitos vivem na aba Plano (24/08/2026).
    await page.getByTestId('aba-plano').click();

    await expect(page.getByTestId('sem-direitos')).toBeVisible();
  });

  test('atribuir plano cria o direito e a ficha passa a mostrar onde e quando vale', async ({
    page,
  }) => {
    await entrar(page);

    // Plano com janela padrão (segunda, 06:00–22:00) na primeira unidade.
    const nomeDoPlano = nomeUnico('Plano Atribuível');

    await criarPlano(page, nomeDoPlano);

    await cadastrarAluno(page, { nome: nomeUnico('Aluno Com Plano'), nascimento: '1999-09-09' });
    await page.getByTestId('abrir-ficha').click();

    /*
     * A ficha virou duas abas e o formulario abre por botao (24/08/2026): a
     * aba Plano existe para RESPONDER "qual acesso este aluno tem", e cinco
     * campos ocupavam mais espaco que a resposta.
     */
    await page.getByTestId('aba-plano').click();
    await page.getByRole('button', { name: /Atribuir plano|Alterar plano/ }).first().click();

    await page.getByTestId('campo-plano').selectOption({ label: nomeDoPlano });
    await page.getByTestId('campo-inicio').fill('2026-01-01T06:00');
    await page.getByTestId('campo-fim').fill('2027-01-01T22:00');
    await page
      .getByTestId('campo-motivo-atribuicao')
      .fill('matrícula presencial na bancada de teste');
    await page.getByTestId('confirmar-atribuicao').click();

    await expect(page.getByTestId('plano-atribuido')).toBeVisible();

    await page.getByRole('link', { name: 'Atualizar a ficha' }).click();

    /*
     * A ABA VOLTA PARA "Informação" ao recarregar -- a página é servidor, e
     * qual aba estava aberta é estado de cliente, que não sobrevive à
     * navegação. Reabrir aqui é o que a recepção faria; guardar a aba na URL
     * é decisão de produto, não conserto de teste.
     */
    await page.getByTestId('aba-plano').click();

    // O ACEITE DA FATIA, literal: "visualiza exatamente quando e onde o
    // acesso é válido". Unidade pelo nome e janela em hora legível -- um
    // UUID e `startMinute: 360` responderiam a pergunta só no papel.
    const direitos = page.getByTestId('tabela-de-direitos');

    await expect(direitos).toBeVisible();
    await expect(direitos).toContainText('Segunda, 06:00–22:00');
    await expect(direitos).toContainText('Assinatura');
  });

  test('a vigência precisa terminar depois de começar', async ({ page }) => {
    await entrar(page);

    const nomeDoPlano = nomeUnico('Plano Para Erro');

    await criarPlano(page, nomeDoPlano);

    await cadastrarAluno(page, { nome: nomeUnico('Vigência Invertida'), nascimento: '1997-02-02' });
    await page.getByTestId('abrir-ficha').click();

    /*
     * A ficha virou duas abas e o formulario abre por botao (24/08/2026): a
     * aba Plano existe para RESPONDER "qual acesso este aluno tem", e cinco
     * campos ocupavam mais espaco que a resposta.
     */
    await page.getByTestId('aba-plano').click();
    await page.getByRole('button', { name: /Atribuir plano|Alterar plano/ }).first().click();

    await page.getByTestId('campo-plano').selectOption({ label: nomeDoPlano });
    await page.getByTestId('campo-inicio').fill('2027-01-01T06:00');
    await page.getByTestId('campo-fim').fill('2026-01-01T22:00');
    await page.getByTestId('campo-motivo-atribuicao').fill('teste de vigência invertida');
    await page.getByTestId('confirmar-atribuicao').click();

    await expect(page.getByTestId('erro-da-atribuicao')).toContainText(/depois do início/i);
  });
});

test.describe('situação do cadastro', () => {
  test('bloquear o aluno avisa que a catraca vai negar', async ({ page }) => {
    await entrar(page);
    await cadastrarAluno(page, { nome: nomeUnico('Aluno Bloqueável'), nascimento: '1991-04-04' });
    await page.getByTestId('abrir-ficha').click();

    // O aluno nasce LEAD, e o domínio não permite LEAD→BLOCKED direto
    // (`TRANSICOES_DE_ALUNO`). O caminho real da recepção passa por ACTIVE —
    // e é justamente isso que o select precisa refletir.
    await page.getByTestId('campo-situacao').selectOption('ACTIVE');
    await page.getByTestId('confirmar-situacao').click();
    await expect(page.getByTestId('situacao-alterada')).toBeVisible();

    await page.reload();

    await page.getByTestId('campo-situacao').selectOption('BLOCKED');
    // Motivo obrigatório desde a issue #241 -- e o select só aparece depois
    // de escolher uma situação que o pede.
    await page.getByTestId('campo-motivo-da-situacao').selectOption('DELINQUENCY');
    await page.getByTestId('confirmar-situacao').click();

    await expect(page.getByTestId('situacao-alterada')).toBeVisible();

    await page.reload();

    // A consequência tem que aparecer, não só o rótulo: "Bloqueado" sozinho
    // não avisa a recepção de que a catraca nega mesmo com plano vigente.
    await expect(page.getByTestId('acesso-impedido')).toContainText(/impede o acesso/i);
  });

  test('duas alterações seguidas sem recarregar -- a segunda não inventa conflito', async ({
    page,
  }) => {
    await entrar(page);
    await cadastrarAluno(page, { nome: nomeUnico('Duas Alterações'), nascimento: '1990-10-10' });
    await page.getByTestId('abrir-ficha').click();

    await page.getByTestId('campo-situacao').selectOption('ACTIVE');
    await page.getByTestId('confirmar-situacao').click();
    await expect(page.getByTestId('situacao-alterada')).toBeVisible();

    // SEM reload no meio -- é exatamente esse o caso que quebrava: o
    // formulário continuava montado com a `version` da carga da página, e a
    // segunda alteração levava "alguém alterou este aluno enquanto você
    // editava" sem ninguém mais envolvido.
    await page.getByTestId('campo-situacao').selectOption('SUSPENDED');
    await page.getByTestId('campo-motivo-da-situacao').selectOption('STUDENT_REQUEST');
    await page.getByTestId('confirmar-situacao').click();

    await expect(page.getByTestId('erro-da-situacao')).toHaveCount(0);
    await expect(page.getByTestId('situacao-alterada')).toContainText('Suspenso');
  });

  test('o select oferece só transições válidas -- nunca a situação atual', async ({ page }) => {
    await entrar(page);
    await cadastrarAluno(page, { nome: nomeUnico('Transições'), nascimento: '1994-06-06' });
    await page.getByTestId('abrir-ficha').click();

    const situacaoAtual = await page.getByTestId('situacao-do-aluno').innerText();
    const opcoes = await page.getByTestId('campo-situacao').locator('option').allInnerTexts();

    // Oferecer o destino que a API recusa produz um 409 depois do clique,
    // sem o operador entender o que fez de errado.
    expect(opcoes).not.toContain(situacaoAtual);
  });
});

test.describe('histórico administrativo', () => {
  test('a timeline registra o cadastro em texto, não em código', async ({ page }) => {
    await entrar(page);
    await cadastrarAluno(page, { nome: nomeUnico('Histórico'), nascimento: '1996-08-08' });
    await page.getByTestId('abrir-ficha').click();
    await page.getByTestId('link-timeline').click();

    await expect(page.getByRole('heading', { name: 'Histórico administrativo' })).toBeVisible();

    // `STUDENT_CREATED` é código de correlação, não frase de interface.
    await expect(page.getByTestId('tabela-da-timeline')).toContainText('Aluno cadastrado');
  });
});

test.describe('navegação da recepção', () => {
  test('alunos e planos estão no menu -- não se chega por URL decorada', async ({ page }) => {
    await entrar(page);
    await page.goto('/operations');

    const navegacao = page.getByRole('navigation', { name: 'Navegacao principal' });

    await expect(navegacao.getByRole('link', { name: 'Alunos' })).toBeVisible();
    await expect(navegacao.getByRole('link', { name: 'Planos' })).toBeVisible();
  });

  test('a ficha leva à biometria -- a rota deixou de ser órfã', async ({ page }) => {
    await entrar(page);
    await cadastrarAluno(page, { nome: nomeUnico('Caminho Biometria'), nascimento: '1992-12-12' });
    await page.getByTestId('abrir-ficha').click();

    await page.getByTestId('link-biometria').click();

    await expect(page).toHaveURL(/\/biometrics$/);
  });
});
