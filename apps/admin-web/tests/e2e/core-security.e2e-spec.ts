import { expect, test } from '@playwright/test';

/**
 * Jornada de `M1-AC-001`: o proprietario entra e ve as unidades do proprio
 * tenant, sem cruzamento.
 *
 * As credenciais vem do seed de bancada (`pnpm --filter @arenahub/database
 * seed`), que o `webServer` do Playwright garante ter rodado.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

test.describe('acesso ao painel', () => {
  test('sem sessao, qualquer rota protegida manda para o login', async ({ page }) => {
    await page.goto('/units');

    // Esconder link nao protege: quem digita a URL chega igual. O redirect
    // acontece no servidor, antes de renderizar.
    await expect(page).toHaveURL(/\/login/);
  });

  test('a raiz tambem manda para o login quando nao ha sessao', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/login/);
  });

  test('credencial invalida nao revela se o e-mail existe', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('E-mail').fill('fantasma@exemplo.test');
    await page.getByLabel('Senha').fill('senha-errada');
    await page.getByRole('button', { name: 'Entrar' }).click();

    const erro = page.getByTestId('erro-de-login');

    await expect(erro).toBeVisible();
    // Mensagem unica: a API ja nao distingue os dois casos, e a interface
    // nao pode desfazer isso.
    await expect(erro).toHaveText('E-mail ou senha invalidos');
  });

  test('preserva o e-mail digitado apos erro, mas nunca a senha', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('E-mail').fill('alguem@exemplo.test');
    await page.getByLabel('Senha').fill('senha-errada');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.getByTestId('erro-de-login')).toBeVisible();
    await expect(page.getByLabel('E-mail')).toHaveValue('alguem@exemplo.test');
    // Senha reapresentada volta no HTML da pagina.
    await expect(page.getByLabel('Senha')).toHaveValue('');
  });

  test('o proprietario entra e ve as unidades do proprio tenant', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('E-mail').fill(DONO.email);
    await page.getByLabel('Senha').fill(DONO.senha);
    await page.getByRole('button', { name: 'Entrar' }).click();

    // O login passa a cair em OPERACAO (24/08/2026): quem abre o painel
    // pergunta "a catraca esta de pe?", nao "quais unidades existem?".
    await expect(page).toHaveURL(/\/operations/);

    // As unidades continuam a um clique, agora sob "Administracao".
    await page.getByRole('link', { name: 'Unidades' }).click();
    await expect(page).toHaveURL(/\/units/);
    await expect(page.getByRole('heading', { name: 'Unidades' })).toBeVisible();
    await expect(page.getByTestId('usuario-logado')).toHaveText(DONO.email);
    await expect(page.getByTestId('tabela-de-unidades')).toBeVisible();
  });

  test('sair encerra a sessao de verdade', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(DONO.email);
    await page.getByLabel('Senha').fill(DONO.senha);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/operations/);

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/login/);

    // Voltar para a rota protegida depois do logout tem de cair no login --
    // se entrasse, o logout teria sido so uma limpeza de cookie.
    await page.goto('/units');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a jornada inteira funciona so com teclado', async ({ page }) => {
    await page.goto('/login');

    // `M1-NFR-008` exige WCAG 2.2 AA nos fluxos administrativos
    // essenciais. Formulario que so funciona com mouse reprova.
    await page.getByLabel('E-mail').focus();
    await page.keyboard.type(DONO.email);
    await page.keyboard.press('Tab');
    await page.keyboard.type(DONO.senha);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/operations/);
  });

  test('o erro de login e anunciavel por leitor de tela', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('E-mail').fill('fantasma@exemplo.test');
    await page.getByLabel('Senha').fill('errada');
    await page.getByRole('button', { name: 'Entrar' }).click();

    // `role="alert"` e o que faz o leitor de tela anunciar sem o usuario
    // ter de procurar. Erro que so muda a cor da borda nao existe para
    // quem nao ve cor.
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('a lista de unidades e uma tabela com cabecalho, nao um monte de div', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(DONO.email);
    await page.getByLabel('Senha').fill(DONO.senha);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/operations/);

    await page.getByRole('link', { name: 'Unidades' }).click();
    await expect(page).toHaveURL(/\/units/);

    // Tabela semantica: leitor de tela le "coluna Codigo, linha 2". Grid de
    // div nao diz nada.
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Codigo' })).toBeVisible();
  });

  test('a pagina responde em 390 px sem transbordar na horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');

    const transbordou = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

    expect(transbordou).toBe(false);
  });
});
