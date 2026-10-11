import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { cadastrarAluno } from './cadastro-de-aluno';

/**
 * F90 -- Relatório de Alunos de ponta a ponta: o menu leva à tela, o filtro
 * escreve na URL e muda a lista, e os dois botões baixam um arquivo de verdade
 * com os dados da academia. Contra a API real: um dublê não provaria que o
 * cookie chega até a rota de download.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

async function entrar(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('relatório de alunos', () => {
  test('o menu leva ao relatório e o aluno cadastrado aparece', async ({ page }) => {
    await entrar(page);
    // A lista é por nome, 20 por página: o contador DECRESCENTE faz o aluno mais novo ordenar primeiro
    // mesmo com execuções anteriores acumuladas no banco, e o teste não depende de paginar.
    const nome = `Aaa ${9_999_999_999_999 - Date.now()} Relatorio E2E`;
    await cadastrarAluno(page, { nome, nascimento: '1990-01-01' });

    await page.getByRole('link', { name: 'Relatórios' }).click();

    await expect(page).toHaveURL(/\/reports\/students/);
    await expect(page.getByRole('heading', { name: 'Relatório de alunos' })).toBeVisible();
    await expect(page.getByTestId('tabela-do-relatorio-de-alunos')).toBeVisible();
    await expect(page.getByText(nome)).toBeVisible();
  });

  test('o filtro escreve na URL e a lista responde', async ({ page }) => {
    await entrar(page);
    await page.goto('/reports/students');

    await page.getByLabel('Situação').selectOption('BLOCKED');

    await expect(page).toHaveURL(/status=BLOCKED/);
    await expect(page.getByLabel('Situação')).toHaveValue('BLOCKED');
  });

  test('Exportar CSV baixa o arquivo com BOM, dados da academia e o filtro aplicado', async ({
    page,
  }) => {
    await entrar(page);
    await page.goto('/reports/students?status=ACTIVE');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: /exportar csv/i }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^relatorio-alunos-\d{4}-\d{2}-\d{2}\.csv$/);

    const bytes = await readFile(await download.path());
    const texto = bytes.toString('utf8');

    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(texto).toContain('Relatório de Alunos');
    expect(texto).toContain('Filtros;Situação: Ativo');
    expect(texto).toContain('Catraca;Nome;CPF;Contato;Plano');
  });

  test('Exportar PDF baixa um PDF de verdade', async ({ page }) => {
    await entrar(page);
    await page.goto('/reports/students');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: /exportar pdf/i }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.pdf$/);

    const bytes = await readFile(await download.path());

    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
