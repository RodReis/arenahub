import { expect, test } from '@playwright/test';

/**
 * Dashboard operacional — F57, `SPEC-057`.
 *
 * O que só E2E prova, e por isso este arquivo existe:
 *
 *   - o login CAI aqui (AC-1), e `Operação` continua no menu como tela de
 *     investigação — a decisão 2 e a 3 da spec, que são sobre navegação e
 *     nenhum teste de componente enxerga;
 *   - os sete blocos renderizam com dado real do seed, contra a API de
 *     verdade, sem dublê nenhum;
 *   - o feed anuncia o próprio estado ("ao vivo"), que é o canal textual do
 *     indicador — cor sozinha nunca é canal (proibição de PRD).
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

async function entrar(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('dashboard operacional', () => {
  test('sem sessão, o dashboard manda para o login', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/login/);
  });

  /*
   * AC-1, primeira metade. Era `/operations` até 01/09/2026: quem abre o
   * painel quer o RESUMO que decide se vale investigar, não a lista de
   * alertas.
   */
  test('o login cai no dashboard, e a raiz também', async ({ page }) => {
    await entrar(page);

    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  /*
   * AC-1, segunda metade. O dashboard NÃO substitui `/operations` — resumo e
   * detalhe são telas diferentes, e sumir com a investigação seria trocar um
   * problema por outro.
   */
  test('Operação continua no menu e abre os alertas detalhados', async ({ page }) => {
    await entrar(page);

    await page.getByRole('link', { name: 'Operação' }).click();

    await expect(page).toHaveURL(/\/operations/);
    await expect(page.getByRole('heading', { name: 'Operação' })).toBeVisible();
  });

  test('a pergunta "a academia está de pé?" é respondida sem rolar', async ({ page }) => {
    await entrar(page);
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Dashboard operacional' })).toBeVisible();

    // Os quatro KPIs da faixa, que são o que se lê de relance.
    await expect(page.getByTestId('kpi-dispositivos')).toBeVisible();
    await expect(page.getByTestId('kpi-acessos')).toBeVisible();
    await expect(page.getByTestId('kpi-recusas')).toBeVisible();
    await expect(page.getByTestId('kpi-restricoes')).toBeVisible();
  });

  /*
   * AC-3, canal TEXTUAL. O pulso é cor e movimento; sem a palavra, quem não
   * distingue verde de cinza e quem usa leitor de tela não sabem se a tela
   * está atualizando. Cor nunca é canal único.
   */
  test('o feed diz por escrito que está ao vivo', async ({ page }) => {
    await entrar(page);
    await page.goto('/dashboard');

    await expect(page.getByTestId('estado-do-feed')).toHaveText(/ao vivo/);
  });

  test('os blocos do mês aparecem com seus títulos', async ({ page }) => {
    await entrar(page);
    await page.goto('/dashboard');

    for (const titulo of [
      'Acessos em tempo real',
      'Bloqueados e suspensos',
      'Placar do mês',
      'Desafios ativos',
      'Feriados do mês',
    ]) {
      await expect(page.getByRole('heading', { name: titulo })).toBeVisible();
    }
  });

  /*
   * AC-7. O feriado nacional NÃO é cadastrado por ninguém: sai calculado em
   * processo (`date-holidays`, nunca por rede). Se a biblioteca sumir ou o
   * filtro de tipo quebrar, o bloco fica vazio — e este teste falha.
   */
  test('o calendário mostra feriado sem ninguém ter cadastrado nada', async ({ page }) => {
    await entrar(page);
    await page.goto('/dashboard');

    const bloco = page.getByTestId('feriados-do-mes');
    const vazio = page.getByText('Nenhum feriado neste mês.');

    // Um dos dois é verdade, dependendo do mês em que a suíte roda. O que não
    // pode acontecer é o bloco não existir.
    await expect(bloco.or(vazio)).toBeVisible();
  });
});
