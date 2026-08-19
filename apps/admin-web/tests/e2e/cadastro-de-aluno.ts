import { expect, type Page } from '@playwright/test';

/**
 * Cadastro de aluno pela interface, num lugar só.
 *
 * A F45 transformou o cadastro num formulário de quatro passos com unidade
 * obrigatória. Antes dela, os testes preenchiam três campos numa tela plana e
 * clicavam em "Cadastrar"; espalhar a navegação entre passos por seis testes
 * faria a próxima mudança de fluxo quebrar todos eles de uma vez.
 *
 * Quem precisa do aluno para testar OUTRA coisa — cobrança, acessibilidade,
 * busca — chama `cadastrarAluno`. Quem testa o wizard em si dirige a tela
 * diretamente, que é o caso de `students.e2e-spec.ts`.
 */

export interface DadosDoAluno {
  nome: string;
  nascimento: string;
  /** Só os dígitos; o campo aplica a máscara sozinho. */
  telefone?: string;
  cpf?: string;
}

/**
 * Preenche o wizard e envia.
 *
 * NÃO espera o resultado: quem chama decide se aguarda sucesso ou erro — há
 * testes que existem justamente para provar a recusa.
 */
export async function preencherCadastro(page: Page, dados: DadosDoAluno): Promise<void> {
  await page.goto('/students/novo');

  await page.getByTestId('campo-fullName').fill(dados.nome);
  await page.getByTestId('campo-birthDate').fill(dados.nascimento);

  if (dados.telefone) {
    await page.getByTestId('campo-telefone').fill(dados.telefone);
  }

  if (dados.cpf) {
    await page.getByTestId('campo-cpf').fill(dados.cpf);
  }

  // Passo 3: a unidade é o único campo que a F45 tornou obrigatório, e ela
  // mora no passo administrativo.
  await page.getByTestId('ir-para-passo-3').click();
  await page.getByTestId('campo-gymUnitId').click();
  await page.getByRole('option').first().click();

  // O envio vive no último passo — é lá que o formulário termina.
  await page.getByTestId('ir-para-passo-4').click();
  await page.getByTestId('confirmar-cadastro').click();
}

/** Cadastra e confirma que a matrícula foi gerada. Devolve a matrícula. */
export async function cadastrarAluno(page: Page, dados: DadosDoAluno): Promise<string> {
  await preencherCadastro(page, dados);

  await expect(page.getByTestId('aluno-cadastrado')).toBeVisible();

  const matricula = await page.getByTestId('matricula-gerada').textContent();

  return matricula ?? '';
}
