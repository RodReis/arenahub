import { expect, test } from '@playwright/test';

import { cadastrarAluno } from './cadastro-de-aluno';

/**
 * F53 Task 13 -- o aceite do PI, ponta a ponta.
 *
 * A FRASE LITERAL: "pesquisa do aluno -> aluno localizado -> na grid, coluna
 * Acao -> icone do pagamento -> pagina de pagar". Este teste dirige a
 * interface pelo caminho exato que a recepcao usa, sem atalho por URL direta
 * para o financeiro -- e a busca e o clique no icone que provam o aceite.
 *
 * SO O CAMINHO DO DINHEIRO: PIX e cartao dependem de webhook do provedor, que
 * nao acontece num teste de navegador -- cobertura deles e de integracao no
 * backend (`billing-http.int-spec.ts`).
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

function nomeUnico(prefixo: string): string {
  return `${prefixo} ${Date.now()}`;
}

/**
 * Gera CPF valido e unico por chamada -- mesma receita de
 * `apps/api/test/integration/students-cadastro-completo.int-spec.ts`
 * (`gerarCpfValido`). REIMPLEMENTAR NAO seria trocar o digito verificador;
 * aqui so falta um contador de modulo para nao colidir com o CPF do teste
 * anterior na mesma execucao (INV-014, duplicidade por CPF).
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

async function entrar(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('a recepcao acha o aluno, cobra e emite recibo', async ({ page }) => {
  await entrar(page);

  // Cenario: aluno com CPF valido (ADR-043) e assinatura ativa -- sem
  // assinatura nao ha cobranca a gerar (INV-066, o ciclo nasce do par
  // assinatura/competencia).
  const nomeDoAluno = nomeUnico('Aluno Balcao');

  /*
   * PLANO DO SEED, e nao um criado pela tela -- e a diferenca importa.
   *
   * Cobranca nasce do par (assinatura, competencia) e precisa de PRECO
   * VIGENTE; sem ele o servidor recusa com "o plano nao tem preco vigente
   * para este periodo". Plano criado pela interface nasce SEM preco, porque
   * `plan_prices` hoje so e escrito pelo seed -- nao existe rota, caso de uso
   * nem campo de formulario que crie preco.
   *
   * Este teste ja falhou por isso: criava o plano na tela, atribuia, e a
   * geracao da cobranca era recusada. O produto estava certo e a recusa foi
   * explicita; o cenario do teste e que era impossivel. A lacuna esta
   * registrada para o PI -- ver o corpo do PR da F53.
   */
  const nomeDoPlano = 'Programa Adultos e Idosos';

  await cadastrarAluno(page, {
    nome: nomeDoAluno,
    nascimento: '1990-05-20',
    cpf: gerarCpfValido(),
  });
  await page.getByTestId('abrir-ficha').click();
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}/);

  await page.getByLabel('Plano', { exact: true }).selectOption({ label: nomeDoPlano });
  await page.getByTestId('campo-inicio').fill('2026-01-01T06:00');
  await page.getByTestId('campo-fim').fill('2027-01-01T22:00');
  await page.getByTestId('campo-motivo-atribuicao').fill('matricula presencial na bancada de teste');
  await page.getByTestId('confirmar-atribuicao').click();
  await expect(page.getByTestId('plano-atribuido')).toBeVisible();

  // ---------------------------------------------------------------------
  // O ACEITE, literal a partir daqui: busca -> localizado -> icone -> pagar.
  // ---------------------------------------------------------------------
  await page.goto('/students');
  await page.getByTestId('busca-de-alunos').fill(nomeDoAluno);

  const linha = page.getByRole('row', { name: new RegExp(nomeDoAluno) });
  await expect(linha).toBeVisible();

  await linha.getByLabel('Cobrança do aluno').click();
  await expect(page).toHaveURL(/\/students\/[^/]+\/billing$/);

  // A cobranca do mes ainda nao existe -- gera antes de poder receber.
  await page.getByTestId('gerar-cobranca').click();

  /*
   * ESPERA A COBRANCA APARECER, e nao o clique retornar.
   *
   * `gerar-cobranca` dispara acao de servidor e a pagina revalida depois; o
   * seletor de forma so existe quando ha fatura em aberto para receber. Ir
   * direto ao `forma-dinheiro` corre com a revalidacao e falha por timeout
   * esperando um elemento que ainda nao foi renderizado -- que foi
   * exatamente como este teste falhou da primeira vez que rodou.
   *
   * Esperar a LINHA da cobranca e determinístico; `waitForTimeout` seria o
   * mesmo bug com aparencia de conserto.
   */
  await expect(page.getByTestId('tabela-de-cobrancas')).toBeVisible();
  await expect(page.getByTestId('forma-dinheiro')).toBeVisible();

  await page.getByTestId('forma-dinheiro').click();
  await page.getByLabel('Valor recebido').fill('150,00');

  /*
   * O MOTIVO E OBRIGATORIO -- confirmar sem preencher tem de ser barrado.
   *
   * `getByRole('alert')` sozinho e ambiguo: a tela tem mais de um alerta
   * vivo, e o Playwright recusa em modo estrito. Casar pelo TEXTO da recusa
   * e o que prova que foi ESTA guarda que barrou, e nao outro aviso qualquer
   * que estivesse na tela por outro motivo.
   */
  await page.getByTestId('confirmar-acao-sensivel').click();
  await expect(page.getByText(/escreva o motivo antes de continuar/i)).toBeVisible();

  await page.getByLabel(/motivo/i).fill('Pagamento em especie no balcao');
  await page.getByTestId('confirmar-acao-sensivel').click();

  await expect(page.getByTestId('recibo-emitido')).toBeVisible();
});
