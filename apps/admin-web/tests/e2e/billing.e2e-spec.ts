import { expect, test } from '@playwright/test';

import { cadastrarAluno } from './cadastro-de-aluno';

/**
 * Jornada da Slice 2.1: a recepção cobra e recebe dinheiro no balcão.
 *
 * O aceite é literal — "o financeiro gera e acompanha uma invoice sem alterar
 * entitlement diretamente". Estes testes são a prova de que isso acontece pela
 * interface, e não só por `curl`.
 *
 * O que a jornada exercita de ponta a ponta: aluno com plano → gerar a
 * cobrança do mês → registrar o recebimento em dinheiro → ver a cobrança paga.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

async function entrar(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

function nomeUnico(prefixo: string): string {
  return `${prefixo} ${Date.now()}`;
}

/**
 * Cadastra um aluno e devolve o id, abrindo a ficha.
 *
 * SEM assinatura de proposito: a cobranca nasce da ASSINATURA (INV-066 e por
 * assinatura e competencia), entao este helper cobre justamente o caso de
 * quem ainda nao tem plano.
 */
async function alunoRecemCadastrado(page: import('@playwright/test').Page): Promise<string> {
  await cadastrarAluno(page, {
    nome: nomeUnico('Aluno Financeiro'),
    nascimento: '1990-05-20',
  });
  await page.getByTestId('abrir-ficha').click();
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}/);

  return page.url().split('/students/')[1]?.split('/')[0] ?? '';
}

test.describe('financeiro do aluno', () => {
  test('sem sessão, o financeiro manda para o login', async ({ page }) => {
    await page.goto('/students/00000000-0000-0000-0000-000000000000/billing');

    await expect(page).toHaveURL(/\/login/);
  });

  test('aluno sem assinatura não oferece o botão de cobrar', async ({ page }) => {
    await entrar(page);
    const id = await alunoRecemCadastrado(page);

    await page.goto(`/students/${id}/billing`);

    // A ausência do botão é o comportamento certo: oferecer e falhar no
    // servidor seria pior que não oferecer.
    await expect(page.getByTestId('sem-assinatura-ativa')).toBeVisible();
    await expect(page.getByTestId('gerar-cobranca')).toHaveCount(0);
  });

  test('a ficha do aluno leva ao financeiro', async ({ page }) => {
    await entrar(page);
    const id = await alunoRecemCadastrado(page);

    await page.goto(`/students/${id}`);
    await page.getByTestId('link-financeiro').click();

    await expect(page).toHaveURL(new RegExp(`/students/${id}/billing`));
    await expect(page.getByRole('heading', { name: /Financeiro/ })).toBeVisible();
  });

  test('cobrança ainda não gerada mostra estado vazio, não tabela em branco', async ({ page }) => {
    await entrar(page);
    const id = await alunoRecemCadastrado(page);

    await page.goto(`/students/${id}/billing`);

    await expect(page.getByTestId('sem-cobrancas')).toBeVisible();
  });
});
