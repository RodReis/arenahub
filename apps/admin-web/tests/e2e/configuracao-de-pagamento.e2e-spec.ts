import { expect, test, type Page } from '@playwright/test';

/**
 * F89 -- configuracao de pagamento (`/configuracao`, aba Pagamento), de ponta
 * a ponta contra a API real: ler os padroes, editar, salvar, recarregar.
 *
 * O tenant semeado nao tem linha em `billing_settings`; o GET devolve os
 * padroes 1 / 10 / 5. A configuracao e do TENANT, compartilhada com as outras
 * suites -- por isso o `afterEach` devolve 1 / 10 / 5 pela propria API, mesmo
 * quando o teste falha no meio.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };
const API = 'http://localhost:3344/api/v1';
const PADRAO = { invoiceGenerationDay: 1, dueDay: 10, graceDays: 5 } as const;

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

const dois = (n: number): string => String(n).padStart(2, '0');

/** A frase que a tela mostra: o exemplo e sempre do mes SEGUINTE ao de hoje (UTC, como o servidor). */
function fraseDoExemplo(c: { gerar: number; vencer: number; bloqueio: number }): string {
  const agora = new Date();
  const proximo = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 1));
  const ano = proximo.getUTCFullYear();
  const mes = proximo.getUTCMonth() + 1;
  const bloqueia = new Date(Date.UTC(ano, mes - 1, c.vencer + c.bloqueio));

  return (
    `Parcela de ${MESES[mes - 1]}/${dois(ano % 100)}: gerada em ${dois(c.gerar)}/${dois(mes)}, ` +
    `vence em ${dois(c.vencer)}/${dois(mes)}, ` +
    `catraca bloqueia em ${dois(bloqueia.getUTCDate())}/${dois(bloqueia.getUTCMonth() + 1)} às 00:00.`
  );
}

async function entrar(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('configuracao de pagamento', () => {
  test.afterEach(async ({ page }) => {
    // Pela API (mesmo cookie de sessao do navegador), nao pela tela: se o teste
    // morreu com a tela quebrada, a restauracao ainda acontece.
    const resposta = await page.request.put(`${API}/billing/settings`, { data: PADRAO });
    expect(resposta.ok()).toBeTruthy();
  });

  test('mostra os padroes, atualiza o exemplo, salva e persiste apos recarregar', async ({ page }) => {
    await entrar(page);
    await page.goto('/configuracao');
    await expect(page.getByTestId('aba-pagamento')).toBeVisible();

    const gerar = page.getByTestId('config-gerar');
    const vencer = page.getByTestId('config-vencer');
    const bloqueio = page.getByTestId('config-bloqueio');
    const exemplo = page.getByTestId('config-exemplo');

    await expect(gerar).toHaveValue('1');
    await expect(vencer).toHaveValue('10');
    await expect(bloqueio).toHaveValue('5');
    await expect(exemplo).toHaveText(fraseDoExemplo({ gerar: 1, vencer: 10, bloqueio: 5 }));

    await vencer.fill('12');
    await bloqueio.fill('3');
    await expect(exemplo).toHaveText(fraseDoExemplo({ gerar: 1, vencer: 12, bloqueio: 3 }));

    await expect(page.getByTestId('config-salvar')).toBeEnabled();
    await page.getByTestId('config-salvar').click();
    await expect(page.getByTestId('sucesso-da-config-de-pagamento')).toBeVisible();

    await page.reload();
    await expect(gerar).toHaveValue('1');
    await expect(vencer).toHaveValue('12');
    await expect(bloqueio).toHaveValue('3');
    await expect(exemplo).toHaveText(fraseDoExemplo({ gerar: 1, vencer: 12, bloqueio: 3 }));
  });

  test('dia de gerar depois do vencimento desabilita o botao e diz por que', async ({ page }) => {
    await entrar(page);
    await page.goto('/configuracao');

    await page.getByTestId('config-gerar').fill('15');

    await expect(page.getByTestId('config-salvar')).toBeDisabled();
    await expect(page.getByText('O dia de gerar não pode ser depois do dia do vencimento.')).toBeVisible();
    await expect(page.getByTestId('config-exemplo')).toHaveText('Corrija os valores para ver o exemplo.');
  });
});
