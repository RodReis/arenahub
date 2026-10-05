import { expect, test } from '@playwright/test';

import { cadastrarAluno } from './cadastro-de-aluno';

/**
 * F85 -- a recepcao lanca um pagamento errado e o cancela pela tela.
 *
 * Mesmo andaime do golden path do lote (`pagamento-em-lote.e2e-spec.ts`):
 * aluno novo, plano do seed, vigencia relativa a agora. Aqui o aluno nao tem
 * mes vencido -- paga o MES CORRENTE (1 chip), cancela, e paga de novo.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };
const NOME_DO_PLANO_DO_SEED = 'Programa Adultos e Idosos';

let proximoCpf = 500;

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

function paraCampoDeData(data: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${data.getUTCFullYear()}-${pad(data.getUTCMonth() + 1)}-${pad(data.getUTCDate())}T${pad(data.getUTCHours())}:${pad(data.getUTCMinutes())}`;
}

test('recepcao cancela pagamento lancado errado e lanca o certo', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await cadastrarAluno(page, {
    nome: `Aluno Cancela ${Date.now()}`,
    nascimento: '1990-05-20',
    cpf: gerarCpfValido(),
  });
  await page.getByTestId('abrir-ficha').click();
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}/);
  const idDoAluno = page.url().split('/students/')[1]?.split('/')[0] ?? '';

  const agora = new Date();
  await page.getByTestId('aba-plano').click();
  await page.getByRole('button', { name: /Atribuir plano|Alterar plano/ }).first().click();
  await page.getByTestId('campo-plano').selectOption({ label: NOME_DO_PLANO_DO_SEED });
  await page
    .getByTestId('campo-inicio')
    .fill(paraCampoDeData(new Date(Date.UTC(agora.getUTCFullYear() - 1, agora.getUTCMonth(), 1, 6, 0))));
  await page
    .getByTestId('campo-fim')
    .fill(paraCampoDeData(new Date(Date.UTC(agora.getUTCFullYear() + 5, agora.getUTCMonth(), 1, 22, 0))));
  await page.getByTestId('campo-motivo-atribuicao').fill('matricula para teste de cancelamento');
  await page.getByTestId('confirmar-atribuicao').click();
  await expect(page.getByTestId('plano-atribuido')).toBeVisible();

  await page.goto(`/students/${idDoAluno}/billing`);
  await expect(page.locator('#titulo-financeiro')).toContainText(/^Financeiro —/);

  /*
   * Paga o mes CORRENTE e o SEGUINTE (adiantado) em dinheiro. Regra do PI
   * (05/10/2026): so o adiantado oferece cancelamento -- o corrente com um
   * pagamento so nao, e mes que ja passou nunca.
   */
  const chips = page.getByRole('button', { name: /^[a-z]{3}\/\d{2}/ });
  await chips.nth(1).click();
  await expect(page.getByText(/2 meses/i)).toBeVisible();
  await page.getByTestId('forma-dinheiro').click();
  await page.getByRole('button', { name: /^Receber$/ }).click();
  await expect(page.getByText(/2 meses recebidos/i)).toBeVisible();

  const grade = page.getByTestId('tabela-de-cobrancas');
  await expect(grade.getByText('Paga')).toHaveCount(2);
  await expect(grade.getByText('Dinheiro')).toHaveCount(2);
  // Os dois blocos da grade: Cobranca e Recebimento.
  await expect(grade.getByRole('columnheader', { name: 'Cobrança' })).toBeVisible();
  await expect(grade.getByRole('columnheader', { name: 'Recebimento' })).toBeVisible();
  // So o mes adiantado ganha o icone de cancelar.
  await expect(page.getByTestId('cancelar-pagamento')).toHaveCount(1);

  // Cancela o adiantado, com motivo.
  await page.getByTestId('cancelar-pagamento').click();
  await page.getByLabel(/Motivo/).fill('lancei no aluno errado');
  await page.getByTestId('confirmar-acao-sensivel').click();

  await expect(page.getByTestId('pagamento-cancelado')).toBeVisible();

  // A grade perdeu o lancamento e a cobranca do adiantado voltou a aberta.
  await expect(grade.getByText('Paga')).toHaveCount(1);
  // O lancamento errado SUMIU da coluna Forma (a linha segue no banco).
  await expect(grade.getByText('Dinheiro')).toHaveCount(1);
  await expect(page.getByTestId('cancelar-pagamento')).toHaveCount(0);

  // E o mes volta a ser pagavel pelo mesmo caminho.
  await page.getByTestId('forma-dinheiro').click();
  await page.getByRole('button', { name: /^Receber$/ }).click();
  await expect(page.getByText(/1 mês recebido/i)).toBeVisible();
  await expect(grade.getByText('Paga')).toHaveCount(2);
});
