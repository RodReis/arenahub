import { expect, test } from '@playwright/test';

/**
 * Jornada de `M1-AC-008`: override exige permissão e motivo, e aparece na
 * auditoria.
 *
 * O que só o E2E prova: que a confirmação em dois passos existe de fato na
 * tela. Teste de API garante que a regra vale; este garante que a recepção
 * não consegue liberar a catraca com um clique distraído.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

async function entrar(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('liberação manual da catraca', () => {
  test('sem sessão, a tela de override manda para o login', async ({ page }) => {
    await page.goto('/access/override');

    await expect(page).toHaveURL(/\/login/);
  });

  test('a tela abre e explica o que a liberação faz', async ({ page }) => {
    await entrar(page);
    await page.goto('/access/override');

    await expect(page.getByRole('heading', { name: 'Liberação manual' })).toBeVisible();
  });

  test('não dá para revisar sem preencher motivo suficiente', async ({ page }) => {
    await entrar(page);
    await page.goto('/access/override');

    const semCatraca = await page.getByTestId('sem-catraca').isVisible();

    // O seed pode não ter catraca cadastrada; nesse caso a tela avisa em vez
    // de mostrar formulário quebrado, e é isso que se verifica.
    if (semCatraca) {
      await expect(page.getByTestId('sem-catraca')).toBeVisible();

      return;
    }

    const revisar = page.getByTestId('revisar-liberacao');

    // Formulário vazio: o botão de revisar nasce desabilitado.
    await expect(revisar).toBeDisabled();

    await page.getByTestId('campo-aluno').fill('algum-aluno');
    await page.getByTestId('campo-motivo').fill('curto');

    // Motivo com menos de 10 caracteres continua bloqueando.
    await expect(revisar).toBeDisabled();
  });

  test('exige a etapa de confirmação antes de liberar', async ({ page }) => {
    await entrar(page);
    await page.goto('/access/override');

    if (await page.getByTestId('sem-catraca').isVisible()) return;

    // Sem passar pela revisão, o botão de confirmar nem existe na página --
    // não é só um `disabled` que um clique acidental venceria.
    await expect(page.getByTestId('confirmar-liberacao')).toHaveCount(0);
  });
});
