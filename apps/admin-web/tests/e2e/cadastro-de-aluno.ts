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
  /**
   * Ausente = usa um CPF válido gerado automaticamente (a maioria dos
   * testes só precisa de "um aluno cadastrado", não de um caso de CPF).
   * String vazia `''` = deixa o campo em branco de propósito, para quem
   * testa a própria validação de CPF obrigatório (ADR-043 Decisão 3).
   */
  cpf?: string;
}

/**
 * CPF valido e UNICO por chamada -- mesma receita de
 * `apps/api/test/integration/students-cadastro-completo.int-spec.ts`
 * (`gerarCpfValido`) e de `pagamento-no-balcao.spec.ts`. Contador, nao
 * aleatorio: teste tem de ser deterministico. CPF e obrigatorio desde o
 * ADR-043 Decisao 3 -- sem um default aqui, os ~17 testes que so precisam de
 * "um aluno cadastrado" (nao de um caso de CPF) teriam de repetir isto cada
 * um.
 */
let proximoCpf = 1;

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

  // CPF obrigatorio desde o ADR-043 Decisao 3. `undefined` usa o default
  // gerado aqui; `''` explicito deixa o campo em branco de proposito (quem
  // testa a propria recusa por CPF ausente passa `cpf: ''`).
  await page.getByTestId('campo-cpf').fill(dados.cpf === undefined ? gerarCpfValido() : dados.cpf);

  // Passo 3: a unidade é o único campo que a F45 tornou obrigatório, e ela
  // mora no passo administrativo.
  await page.getByTestId('ir-para-passo-3').click();

  /*
   * `selectOption` num `<select>` NATIVO -- um gesto, não dois.
   *
   * Enquanto a tela usava o combobox de `<div>` do Base UI (issue #231), este
   * trecho precisava de `.click()` para abrir o menu e de
   * `getByRole('option').first().click()` para escolher: o Playwright não tem
   * como falar com um combobox que não é `<select>`, e a API dedicada ficava
   * fora de alcance.
   *
   * `index: 1` e não `0` porque a primeira `<option>` é o placeholder
   * ("Selecione a unidade"), que existe porque `<select>` nativo não tem
   * atributo de placeholder -- sem ela o primeiro item pareceria já escolhido.
   */
  await page.getByTestId('campo-gymUnitId').selectOption({ index: 1 });

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
