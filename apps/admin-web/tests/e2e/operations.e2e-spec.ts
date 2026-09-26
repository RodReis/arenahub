import { expect, test } from '@playwright/test';

/**
 * Jornada de `M1-AC-011`: a equipe opera sem abrir banco, terminal ou log.
 *
 * O aceite da Slice 1.6 é literal — "equipe opera um turno completo sem
 * acesso direto a banco, terminal ou logs brutos". Estes testes percorrem o
 * caminho de um turno: abrir o painel, ver o estado, investigar um evento.
 * Nenhum passo aqui usa `psql`, e é essa a prova.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

async function entrar(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('painel operacional', () => {
  test('sem sessão, o painel manda para o login', async ({ page }) => {
    await page.goto('/operations');

    await expect(page).toHaveURL(/\/login/);
  });

  test('o painel responde a pergunta mais urgente na primeira linha', async ({ page }) => {
    await entrar(page);
    await page.goto('/operations');

    await expect(page.getByRole('heading', { name: 'Operação' })).toBeVisible();

    // Quem passa pela tela entre dois atendimentos lê isto e nada mais.
    const resumo = page.getByTestId('resumo-da-operacao');

    await expect(resumo).toBeVisible();
    await expect(resumo).toContainText(/problema|Nenhum/);
  });

  test('mostra Edge, dispositivos, sync e acesso sem abrir banco', async ({ page }) => {
    await entrar(page);
    await page.goto('/operations');

    await expect(page.getByRole('heading', { name: 'Edge' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dispositivos' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sincronização de biometria' })).toBeVisible();
    await expect(page.getByTestId('resumo-de-acesso')).toBeVisible();
  });

  test('todo estado tem TEXTO, não só cor', async ({ page }) => {
    await entrar(page);
    await page.goto('/operations');

    const corpo = await page.locator('main').innerText();

    // Um painel que comunica "crítico" só por vermelho não comunica para
    // quem não distingue vermelho -- e isso é cerca de 8% dos homens.
    expect(corpo).toMatch(/Respondendo|Sem resposta|Nenhum Edge/);
  });

  test('a navegação leva ao painel sem digitar URL', async ({ page }) => {
    await entrar(page);

    await page.getByRole('link', { name: 'Operação' }).click();

    await expect(page).toHaveURL(/\/operations/);
  });
});

test.describe('eventos de acesso', () => {
  test('sem sessão, manda para o login', async ({ page }) => {
    await page.goto('/access-events');

    await expect(page).toHaveURL(/\/login/);
  });

  test('abre com o período padrão e permite filtrar', async ({ page }) => {
    await entrar(page);
    await page.goto('/access-events');

    await expect(page.getByRole('heading', { name: 'Eventos de acesso' })).toBeVisible();

    await page.getByLabel('Resultado').selectOption('DENY');
    await page.getByTestId('filtrar').click();

    // Filtro vai para a URL: o operador manda o link ao colega e chega na
    // mesma tela, e o botão voltar funciona.
    await expect(page).toHaveURL(/outcome=DENY/);
  });

  test('estado vazio explica o próximo passo', async ({ page }) => {
    await entrar(page);
    // Período no passado remoto: garantidamente sem evento.
    await page.goto('/access-events?from=2020-01-01T00:00&to=2020-01-02T00:00');

    const vazio = page.getByTestId('sem-eventos');

    if (await vazio.isVisible()) {
      // "Nenhum resultado" sozinho deixa o operador sem saber o que fazer.
      await expect(vazio).toContainText('Ajuste os filtros');
    }
  });

  /**
   * A JORNADA DO INSTALADOR -- issue #404.
   *
   * O `POST /edge-nodes/:id/pairing-codes` existia desde a F59 e exigia um
   * `EdgeNode` que nenhuma tela criava: a primeira execução real do runbook
   * `docs/operations/smart-access/install.md` travou aqui. Este teste é o
   * caminho que destravou -- e o único lugar onde ele pode ser provado
   * inteiro, porque o código só aparece depois de duas idas ao servidor, o
   * que jsdom não exercita.
   */
  test('cadastra um Edge e recebe o código de pareamento', async ({ page }) => {
    await entrar(page);
    await page.goto('/operations');

    await page.getByTestId('novo-edge-node').click();
    await expect(page).toHaveURL(/\/operations\/edge-nodes\/novo/);

    // Código único por execução: a constraint é `(tenantId, code)`, e o
    // banco do E2E não é recriado entre um teste e outro.
    const codigoDoEdge = `E2E-EDGE-${Date.now()}`;

    await page.getByTestId('campo-codigo-do-edge-node').fill(codigoDoEdge);
    await page.getByTestId('confirmar-edge-node').click();

    await expect(page.getByTestId('edge-node-cadastrado')).toContainText(codigoDoEdge);

    // O pareamento é o segundo ato, na mesma tela: na instalação real, quem
    // cadastra está com o PC da recepção na frente e precisa do código agora.
    await page.getByTestId('gerar-pareamento').click();

    const codigo = page.getByTestId('codigo-de-pareamento');

    await expect(codigo).toBeVisible();
    // O que o operador precisa saber: que é irrepetível e onde colar.
    await expect(codigo).toContainText('uma única vez');
    await expect(codigo).toContainText('EDGE_PAIRING_CODE');
  });

  /**
   * RE-PAREAMENTO -- o código morre no primeiro uso e o ADR-011 prevê
   * revogação pelo painel. Sem ação na linha, um Edge revogado só voltaria a
   * funcionar cadastrando outro, duplicando o registro.
   */
  test('gera novo código para um Edge já cadastrado, pela tabela', async ({ page }) => {
    await entrar(page);
    await page.goto('/operations');

    const parear = page.getByTestId('parear-edge').first();

    // Sem Edge cadastrado a tabela está vazia -- e aí o teste anterior é
    // quem cobre o caminho. Este exercita a ação de linha quando ela existe.
    if (!(await parear.isVisible())) return;

    await parear.click();

    await expect(page.getByTestId('codigo-de-pareamento').first()).toBeVisible();
  });
});
