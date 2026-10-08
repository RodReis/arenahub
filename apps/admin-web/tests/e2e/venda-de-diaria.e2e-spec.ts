import { expect, test, type Page } from '@playwright/test';

import { cadastrarAluno } from './cadastro-de-aluno';

/**
 * F86 -- o golden path da diaria: a recepcao cadastra um aluno SEM plano, vende a
 * diaria pela ficha e o acesso aparece ate o fim do dia.
 *
 * O PLANO DE DIARIA E CRIADO PELA API, com janela nos 7 dias, 00:00-24:00: o plano
 * `Diaria` do seed abre so de segunda a sexta (06:00-22:00), e o teste falharia
 * sozinho no fim de semana ou de noite (`DAY_PASS_CLOSED_TODAY`) -- exatamente a
 * regra que o teste de integracao ja prova. Aqui o que importa e a TELA.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };
const API = 'http://localhost:3344';

let proximoCpf = 700;

function gerarCpfValido(): string {
  const base = String(100000000 + ((proximoCpf * 97) % 899999999)).padStart(9, '0');
  proximoCpf += 1;

  const digitos = base.split('').map(Number);
  const verificador = (ate: number, seq: number[]): number => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += seq[i]! * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = verificador(9, digitos);
  const d2 = verificador(10, [...digitos, d1]);

  return `${base}${d1}${d2}`;
}

async function entrar(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('recepcao vende a diaria a um aluno sem plano e o acesso vale ate a meia-noite', async ({
  page,
}) => {
  await entrar(page);

  await cadastrarAluno(page, {
    nome: `Aluno Diaria ${Date.now()}`,
    nascimento: '1990-05-20',
    cpf: gerarCpfValido(),
  });
  await page.getByTestId('abrir-ficha').click();
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}/);
  const idDoAluno = page.url().split('/students/')[1]?.split('/')[0] ?? '';

  // A unidade do aluno -- o plano de diaria precisa abrir nela.
  const aluno = await page.request.get(`${API}/api/v1/students/${idDoAluno}`);
  expect(aluno.ok()).toBeTruthy();
  const unidadeId = ((await aluno.json()) as { gymUnitId: string }).gymUnitId;

  const nomeDoPlano = `Diaria E2E ${Date.now()}`;
  const criado = await page.request.post(`${API}/api/v1/plans`, {
    data: {
      name: nomeDoPlano,
      gymUnitIds: [unidadeId],
      janelas: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        gymUnitId: unidadeId,
        dayOfWeek,
        startMinute: 0,
        endMinute: 1440,
      })),
      amountMinor: 3000,
      billingMode: 'DIARIA',
    },
  });
  expect(criado.status()).toBe(201);

  await page.reload();
  await page.getByTestId('aba-plano').click();

  // O plano de diaria NAO aparece na lista de atribuicao (daria acesso sem pagar).
  await page
    .getByRole('button', { name: /Atribuir plano|Alterar plano/ })
    .first()
    .click();
  const opcoes = await page.getByTestId('campo-plano').locator('option').allTextContents();
  expect(opcoes.some((o) => o.startsWith(nomeDoPlano))).toBe(false);

  await page.getByTestId('abrir-venda-de-diaria').click();
  // Escolhe o plano criado aqui (janela 24h): o `Diaria` do seed fecha as 22:00 e vem primeiro.
  const valorDoPlano = await page
    .getByTestId('diaria-plano')
    .locator('option', { hasText: nomeDoPlano })
    .getAttribute('value');
  expect(valorDoPlano).toBeTruthy();
  await page.getByTestId('diaria-plano').selectOption(valorDoPlano);
  await expect(page.getByTestId('diaria-valor')).toContainText('R$ 30,00');

  await page.getByTestId('forma-dinheiro').click();
  await page.getByTestId('confirmar-diaria').click();

  await expect(page.getByText('Diária paga. O acesso vale até 23:59.')).toBeVisible();

  // O direito existe, esta ATIVO e vence na proxima meia-noite local.
  const direitos = await page.request.get(`${API}/api/v1/students/${idDoAluno}/entitlements`);
  expect(direitos.ok()).toBeTruthy();
  const lista = (await direitos.json()) as { status: string; endsAt: string }[];
  const ativo = lista.find((d) => d.status === 'ACTIVE');
  expect(ativo).toBeTruthy();

  const fim = new Date(ativo!.endsAt);
  expect(fim.getTime()).toBeGreaterThan(Date.now());
  expect(fim.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
});

test('recepcao vende a diaria direto da tela de Cobranca do aluno sem plano', async ({ page }) => {
  await entrar(page);

  await cadastrarAluno(page, {
    nome: `Aluno Diaria Cobranca ${Date.now()}`,
    nascimento: '1990-05-20',
    cpf: gerarCpfValido(),
  });
  await page.getByTestId('abrir-ficha').click();
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}/);
  const idDoAluno = page.url().split('/students/')[1]?.split('/')[0] ?? '';

  const aluno = await page.request.get(`${API}/api/v1/students/${idDoAluno}`);
  expect(aluno.ok()).toBeTruthy();
  const unidadeId = ((await aluno.json()) as { gymUnitId: string }).gymUnitId;

  const nomeDoPlano = `Diaria E2E Cobranca ${Date.now()}`;
  const criado = await page.request.post(`${API}/api/v1/plans`, {
    data: {
      name: nomeDoPlano,
      gymUnitIds: [unidadeId],
      janelas: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        gymUnitId: unidadeId,
        dayOfWeek,
        startMinute: 0,
        endMinute: 1440,
      })),
      amountMinor: 3000,
      billingMode: 'DIARIA',
    },
  });
  expect(criado.status()).toBe(201);

  await page.goto(`/students/${idDoAluno}/billing`);
  await expect(page.getByTestId('sem-assinatura-ativa')).toBeVisible();

  await page.getByTestId('abrir-venda-de-diaria').click();
  // Escolhe o plano criado aqui (janela 24h): o `Diaria` do seed fecha as 22:00 e vem primeiro.
  const valorDoPlano = await page
    .getByTestId('diaria-plano')
    .locator('option', { hasText: nomeDoPlano })
    .getAttribute('value');
  expect(valorDoPlano).toBeTruthy();
  await page.getByTestId('diaria-plano').selectOption(valorDoPlano);
  await page.getByTestId('forma-dinheiro').click();
  await page.getByTestId('confirmar-diaria').click();

  await expect(page.getByText('Diária paga. O acesso vale até 23:59.')).toBeVisible();

  const direitos = await page.request.get(`${API}/api/v1/students/${idDoAluno}/entitlements`);
  const lista = (await direitos.json()) as { status: string }[];
  expect(lista.some((d) => d.status === 'ACTIVE')).toBe(true);
});
