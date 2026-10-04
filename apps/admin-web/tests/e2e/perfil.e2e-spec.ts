import { expect, test, type Page } from '@playwright/test';

/**
 * Perfil e troca de senha -- SPEC-XXX.
 *
 * USUARIO PROPRIO, criado por convite: trocar a senha do dono semeado
 * quebraria todas as outras suites, que entram com ela.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };
const SENHA_INICIAL = 'senha-inicial-do-e2e';
const SENHA_NOVA = 'senha-trocada-no-e2e';

async function entrarCom(page: Page, email: string, senha: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Convida pelo painel e aceita o convite: a conta nasce com `SENHA_INICIAL`. */
async function criarContaPorConvite(page: Page, email: string): Promise<void> {
  await entrarCom(page, DONO.email, DONO.senha);
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto('/users');
  await page.getByTestId('convidar-usuario').click();
  await page.getByTestId('campo-email-do-convite').fill(email);
  await page.getByTestId('confirmar-convite').click();

  const link = page.getByTestId('link-do-convite');
  await expect(link).toBeVisible();
  const caminho = (await link.getAttribute('href')) ?? '';

  await page.goto(caminho);
  await page.getByLabel('Nova senha').fill(SENHA_INICIAL);
  await page.getByLabel('Repita a senha').fill(SENHA_INICIAL);
  await page.getByRole('button', { name: /criar senha/i }).click();
  await expect(page.getByTestId('aceite-concluido')).toBeVisible();
}

test('o chip da topbar abre o perfil e a senha trocada passa a valer', async ({ page }) => {
  const email = `perfil-e2e-${Date.now()}@exemplo.test`;

  await criarContaPorConvite(page, email);
  // Sai do dono antes de entrar como o convidado: a sessao do dono ainda vale.
  await page.context().clearCookies();
  await entrarCom(page, email, SENHA_INICIAL);
  await expect(page).not.toHaveURL(/\/login/);

  await page.getByTestId('link-do-perfil').click();
  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByTestId('perfil-email')).toHaveText(email);

  // Erro primeiro: a senha atual errada nao muda nada.
  await page.getByLabel('Senha atual', { exact: true }).fill('senha-errada-qualquer');
  await page.getByLabel('Nova senha', { exact: true }).fill(SENHA_NOVA);
  await page.getByLabel('Confirmar nova senha').fill(SENHA_NOVA);
  await page.getByTestId('salvar-senha').click();
  await expect(page.getByTestId('erro-da-senha')).toBeVisible();

  await page.getByLabel('Senha atual', { exact: true }).fill(SENHA_INICIAL);
  await page.getByLabel('Nova senha', { exact: true }).fill(SENHA_NOVA);
  await page.getByLabel('Confirmar nova senha').fill(SENHA_NOVA);
  await page.getByTestId('salvar-senha').click();
  await expect(page.getByTestId('senha-trocada')).toBeVisible();
  await expect(page.getByLabel('Senha atual', { exact: true })).toHaveValue('');

  // Esta sessao continua de pe.
  await page.reload();
  await expect(page).toHaveURL(/\/perfil$/);

  // A antiga nao entra; a nova entra.
  await page.context().clearCookies();
  await entrarCom(page, email, SENHA_INICIAL);
  await expect(page).toHaveURL(/\/login/);
  await entrarCom(page, email, SENHA_NOVA);
  await expect(page).not.toHaveURL(/\/login/);
});
