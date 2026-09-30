import { expect, test } from '@playwright/test';

import { cadastrarAluno } from './cadastro-de-aluno';
import { criarPlano } from './cadastro-de-plano';

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
 *
 * O PLANO AGORA NASCE NA TELA, nao no seed -- essa e a lacuna que a fatia
 * "preco de plano" fechou. Ate o commit f1a8b9b, plano criado pela interface
 * nascia sem preco em `plan_prices` e a geracao de cobranca era recusada;
 * este teste falhava exatamente aqui e usava o plano do seed como contorno.
 * Com o campo de preco na tela (`criarPlano`), o caminho completo -- criar,
 * atribuir, cobrar -- passa a ser possivel de ponta a ponta.
 *
 * ATUALIZADO NA F83 (fix de revisao): `FaixaDeMeses` (Task 7) substituiu o
 * campo "Valor recebido" + `SensitiveAction` (motivo obrigatorio) + recibo
 * em especie pelo fluxo de chips -- este teste rodava contra uma tela que
 * nao existe mais (o campo "Valor recebido" foi removido, e falharia em
 * qualquer execucao real). O CAMINHO QUE ESTE TESTE PROVA -- busca do aluno,
 * icone de cobranca na grid, criacao de plano pela tela -- continua unico
 * aqui (o spec de lote navega direto por URL e usa o plano do seed); so a
 * PARTE FINAL (receber e confirmar) foi reescrita para `FaixaDeMeses`.
 *
 * CONCERN (achado desta revisao, fora de escopo consertar aqui): `FaixaDeMeses`
 * nao chama `emitirReciboDaInvoice`/`emitirReciboDoPagamento` nem exige motivo
 * (`SensitiveAction`) -- os dois existem ainda em `app/actions/billing.ts` mas
 * ficaram orfaos do caminho de lote. O pagamento em lote hoje NAO emite
 * recibo em especie nem pede motivo de auditoria. Reportado no relatorio da
 * tarefa; produto decide se isso volta.
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

  // PLANO CRIADO PELA TELA -- o aceite desta fatia. Preco obrigatorio no
  // formulario (`criarPlano`) e o que torna este caminho possivel: cobranca
  // nasce do par (assinatura, competencia) e precisa de PRECO VIGENTE, e ate
  // a F53 "preco de plano" nao havia onde cadastra-lo pela interface.
  const nomeDoPlano = nomeUnico('Programa Adultos e Idosos');

  await criarPlano(page, nomeDoPlano);

  await cadastrarAluno(page, {
    nome: nomeDoAluno,
    nascimento: '1990-05-20',
    cpf: gerarCpfValido(),
  });
  await page.getByTestId('abrir-ficha').click();
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}/);

  /*
   * A ficha virou duas abas e o formulario de plano abre por botao
   * (24/08/2026) -- ver `students.e2e-spec.ts` para o porque.
   */
  await page.getByTestId('aba-plano').click();
  await page.getByRole('button', { name: /Atribuir plano|Alterar plano/ }).first().click();

  await page.getByTestId('campo-plano').selectOption({ label: nomeDoPlano });
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

  /*
   * FaixaDeMeses (F83, Task 7) substituiu o campo "Valor recebido" + o motivo
   * obrigatorio (`SensitiveAction`) -- a cobranca do mes CORRENTE, recem
   * gerada acima, vem OVERDUE/OPEN e ja chega pre-selecionada (`indiceInicial`,
   * `faixa-de-meses.tsx`): basta escolher a forma e clicar em "Receber".
   */
  await page.getByTestId('forma-dinheiro').click();
  await page.getByRole('button', { name: /^Receber$/ }).click();

  await expect(page.getByText(/1 mês recebido/i)).toBeVisible();

  // A cobranca sai de OPEN para Paga na tabela -- o aceite original desta
  // fatia ("pesquisa -> localizado -> icone -> pagina de pagar") termina em
  // pagamento CONFIRMADO, nao so em o botao ter sido clicado.
  await expect(page.getByTestId('tabela-de-cobrancas').getByText('Paga')).toBeVisible();
});
