import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * WCAG 2.2 AA nos fluxos essenciais -- DS-PAINEL.md §10.
 *
 * `axe-core` NAO prova acessibilidade: prova AUSENCIA de uma lista conhecida
 * de defeitos. Contraste calculado, foco visivel, rotulo faltando e ordem de
 * cabecalho ele pega; "o rotulo diz a coisa certa" nenhuma ferramenta pega --
 * isso continua sendo trabalho dos E2E de jornada e da revisao.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function entrar(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const TELAS = ['/units', '/students', '/plans', '/operations', '/access-events'];

test.describe('acessibilidade WCAG 2.2 AA', () => {
  test('a tela de login nao tem violacao', async ({ page }) => {
    await page.goto('/login');

    const resultado = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    expect(resultado.violations).toEqual([]);
  });

  for (const tela of TELAS) {
    test(`${tela} nao tem violacao`, async ({ page }) => {
      await entrar(page);
      await page.goto(tela);

      const resultado = await new AxeBuilder({ page }).withTags(TAGS).analyze();

      expect(resultado.violations).toEqual([]);
    });
  }

  /**
   * §10 item 8: zoom de 200% sem perda de conteudo.
   *
   * 1280 px de largura logica a 200% equivale a 640 px CSS. A pagina pode
   * rolar na VERTICAL -- o que a regra proibe e a rolagem horizontal, que
   * obriga a varrer cada linha nos dois eixos para ler uma frase.
   */
  test('zoom de 200% nao corta conteudo', async ({ page }) => {
    await entrar(page);
    await page.goto('/students');
    await page.setViewportSize({ width: 640, height: 720 });

    const transborda = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

    expect(transborda).toBe(false);
  });
});
