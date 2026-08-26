import { expect, test, type Page } from '@playwright/test';

/**
 * Aceite da F50 (issue #151), literal: "o gerente altera marca, cor e
 * sessão, publica, e o totem reflete a mudança sem interromper aluno em
 * sessão. Descartar restaura o publicado."
 *
 * A prova de que o TOTEM em si serve o publicado, nunca o rascunho, já vive
 * no teste de integração da Task 3; a prova de sessão sobrevivendo a
 * reinício já vive no teste unitário da Task 4. Este E2E prova o que só o
 * painel pode provar: a jornada do gerente na UI -- alterar, salvar,
 * publicar, descartar -- sem tocar em banco, HMAC ou rota do totem.
 *
 * Totem do seed: `TOTEM01` (`packages/database/prisma/seed.ts`,
 * `semearTotem`), já com uma configuração de UNIDADE v1 publicada.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

async function entrar(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function abrirConfiguracaoDoTotem(page: Page): Promise<void> {
  await page.goto('/operations/kiosks');

  const linha = page.getByRole('row', { name: /TOTEM01/i });
  await expect(linha).toBeVisible();

  await linha.getByRole('link', { name: 'Configurar' }).click();
  await expect(page).toHaveURL(/\/operations\/kiosks\/[^/]+$/);
}

test.describe('F50 -- personalização do totem', () => {
  test('altera marca, cor e sessão, salva e publica', async ({ page }) => {
    await entrar(page);
    await abrirConfiguracaoDoTotem(page);

    await page.getByRole('tab', { name: 'Marca' }).click();
    await page.getByLabel('Slogan').fill('Treine com a gente');

    await page.getByRole('tab', { name: 'Aparência' }).click();
    await page.getByRole('radio', { name: /verde/i }).check();

    await page.getByRole('tab', { name: 'Sessão' }).click();
    await page.getByLabel('Duração da sessão').selectOption('90');

    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(page.getByTestId('barra-de-estado')).toHaveText(/rascunho não publicado/i);

    await page.getByRole('button', { name: 'Publicar' }).click();

    // Depois de publicar, o rascunho deixa de existir: a barra volta ao
    // estado "sem alterações" -- é a mudança visível de estado que prova a
    // publicação, e os botões Publicar/Descartar (que só aparecem com
    // rascunho pendente) somem da tela.
    await expect(page.getByTestId('barra-de-estado')).toHaveText(/sem alterações/i);
    await expect(page.getByRole('button', { name: 'Publicar' })).toHaveCount(0);

    // O valor publicado continua refletido no formulário -- a base do
    // rascunho seguinte parte do que acabou de virar efetivo.
    await expect(page.getByLabel('Slogan')).toHaveValue('Treine com a gente');
  });

  test('descartar restaura o publicado', async ({ page }) => {
    await entrar(page);
    await abrirConfiguracaoDoTotem(page);

    const sloganPublicado = await page.getByLabel('Slogan').inputValue();

    await page.getByRole('tab', { name: 'Marca' }).click();
    await page.getByLabel('Slogan').fill('rascunho que sera jogado fora');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();

    await expect(page.getByTestId('barra-de-estado')).toHaveText(/rascunho não publicado/i);

    // `Descartar` usa `window.confirm` nativo -- não há botão "Confirmar" na
    // tela; o dublê de confirmação é o listener de diálogo do Playwright.
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Descartar rascunho' }).click();

    await expect(page.getByTestId('barra-de-estado')).toHaveText(/sem alterações/i);
    await expect(page.getByLabel('Slogan')).toHaveValue(sloganPublicado);
    await expect(page.getByLabel('Slogan')).not.toHaveValue('rascunho que sera jogado fora');
  });
});
