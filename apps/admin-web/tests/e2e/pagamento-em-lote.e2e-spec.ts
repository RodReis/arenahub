import { expect, test } from '@playwright/test';

import { cadastrarAluno } from './cadastro-de-aluno';

/**
 * F83 Task 8 -- o golden path do pagamento em lote pela interface.
 *
 * A FRASE LITERAL do brief: "aluno com 1 mes vencido paga ate corrente+1 e
 * fica em dia". Isto exercita `FaixaDeMeses` (Task 7) de ponta a ponta --
 * clicar em mais de um chip de mes, nao o antigo botao unico
 * "Gerar cobranca do mes" -- contra a API real (rotas da Task 3), nao
 * mockada.
 *
 * SEED DO CENARIO "1 mes vencido": nao existe hoje um caminho pela TELA para
 * abrir uma invoice de um MES PASSADO -- `abrirCobranca` (o botao "Gerar
 * cobranca do mes") so abre o mes CORRENTE. A unica rota que aceita `emQue`
 * arbitrario e `POST /api/v1/invoices`. Chamamos via `page.request`, que
 * reusa o MESMO cookie de sessao do navegador (login por cookie, sem
 * `domain` explicito -- `localhost:3000` e `localhost:3344` compartilham o
 * cookie por serem o mesmo host). Nao ha acesso a Prisma nem a outro banco
 * aqui: e a API de producao, pelo mesmo mecanismo de autenticacao que a
 * tela usa.
 *
 * NAO RODAMOS `POST /billing/delinquency/apply` (o job de vencimento) de
 * proposito -- achado desta tarefa, nao decisao de design: `graceDays: 5`
 * no seed, com `dueDay: 10` fixo e qualquer mes passado inteiro sempre mais
 * de 5 dias vencido, faz o job suspender o ENTITLEMENT
 * (`aplicar-inadimplencia.use-case.ts`), e a tela de financeiro
 * (`page.tsx`) so mostra `FaixaDeMeses` quando ha entitlement `ACTIVE` --
 * exatamente o aluno que mais precisa pagar por aqui fica sem o botao de
 * pagar. Reportado como CONCERN no relatorio da task; nao e escopo desta
 * tarefa (escrever o E2E) consertar o componente de producao. A invoice
 * fica `OPEN` com `dueAt` genuinamente no passado -- o mesmo estado real de
 * "venceu, ainda nao foi processado pelo job" que a ausencia de agendador
 * no MVP 2 comporta (`billing.controller.ts`, comentario de
 * `aplicarInadimplenciaAgora`).
 *
 * A faixa nasce do mes em aberto mais antigo (`mesesPagaveis`,
 * domain/meses-pagaveis.ts): com 1 invoice OPEN do mes passado e nenhuma
 * outra, a faixa e [em aberto (vencido de fato), corrente NOT_OPENED,
 * corrente+1 NOT_OPENED, ...] -- o proprio caso do brief, sem precisar
 * gerar a cobranca do mes corrente a parte. A selecao INICIAL de
 * `FaixaDeMeses` marca so o primeiro chip (unico OVERDUE/OPEN da faixa);
 * o teste clica nos dois chips seguintes para estender ate corrente+1,
 * exatamente como o brief descreve ("clicar no mes seguinte ao corrente").
 * O uso do lote (`RegistrarPagamentoEmLoteUseCase`) abre a invoice dos
 * meses NOT_OPENED sozinho.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

/**
 * Plano do SEED (`packages/database/prisma/seed.ts`, `CATALOGO`), nao criado
 * pela tela: seu preco tem `validFrom` ancorado em 2026-01-01 -- exatamente
 * para que qualquer invoice de teste, inclusive de mes PASSADO, encontre
 * preco vigente (`precoVigenteEm`). Um plano criado agora pela tela
 * (`criarPlano`) tem `validFrom` = hoje, e abrir a invoice do mes anterior
 * contra ele e recusado com `PLAN_WITHOUT_ACTIVE_PRICE` -- foi o que
 * aconteceu na primeira tentativa deste teste.
 */
const NOME_DO_PLANO_DO_SEED = 'Programa Adultos e Idosos';

function nomeUnico(prefixo: string): string {
  return `${prefixo} ${Date.now()}`;
}

/** Mesma receita de `pagamento-no-balcao.e2e-spec.ts` -- CPF valido e unico por chamada. */
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

/** Primeiro dia do mes anterior ao atual, em UTC -- mesma normalizacao que o dominio usa. */
function primeiroDiaDoMesAnterior(): string {
  const agora = new Date();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1)).toISOString();
}

test('aluno com 1 mes vencido paga ate corrente+1 e fica em dia', async ({ page }) => {
  await entrar(page);

  const nomeDoAluno = nomeUnico('Aluno Lote');

  await cadastrarAluno(page, {
    nome: nomeDoAluno,
    nascimento: '1990-05-20',
    cpf: gerarCpfValido(),
  });
  await page.getByTestId('abrir-ficha').click();
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}/);
  const idDoAluno = page.url().split('/students/')[1]?.split('/')[0] ?? '';

  // Assinatura com inicio em 2026-01-01 -- precisa cobrir o mes passado que
  // vai virar a invoice em aberto, senao `abrirInvoiceDoPeriodo` recusaria o
  // periodo por estar fora da vigencia (`endsAt`/inicio da assinatura).
  await page.getByTestId('aba-plano').click();
  await page.getByRole('button', { name: /Atribuir plano|Alterar plano/ }).first().click();
  await page.getByTestId('campo-plano').selectOption({ label: NOME_DO_PLANO_DO_SEED });
  await page.getByTestId('campo-inicio').fill('2026-01-01T06:00');
  await page.getByTestId('campo-fim').fill('2027-01-01T22:00');
  await page.getByTestId('campo-motivo-atribuicao').fill('matricula para teste de pagamento em lote');
  await page.getByTestId('confirmar-atribuicao').click();
  await expect(page.getByTestId('plano-atribuido')).toBeVisible();

  await page.goto(`/students/${idDoAluno}/billing`);
  await expect(page.locator('#titulo-financeiro')).toContainText(/^Financeiro —/);

  // A assinatura mora atras da tela -- sem endpoint de leitura direta aqui,
  // pega-se o id pela mesma rota que a tela usa (`entitlements`).
  const direitos = await page.request.get(`http://localhost:3344/api/v1/students/${idDoAluno}/entitlements`);
  expect(direitos.ok()).toBeTruthy();
  const listaDeDireitos = (await direitos.json()) as { status: string; subscriptionId: string | null }[];
  const subscriptionId = listaDeDireitos.find((d) => d.status === 'ACTIVE' && d.subscriptionId)?.subscriptionId;
  expect(subscriptionId).toBeTruthy();

  /*
   * ABRE a invoice do mes PASSADO -- unica rota que aceita `emQue` fora do
   * mes corrente (`abrirCobranca`/botao "Gerar cobranca do mes" so abre o
   * corrente). Nasce OPEN, com `dueAt` genuinamente no passado -- "vencido"
   * de fato, mesmo sem o rotulo "Vencido" da UI (ver nota no topo do
   * arquivo: o job de vencimento suspenderia o entitlement e esconderia o
   * proprio botao de pagar).
   */
  const abertura = await page.request.post('http://localhost:3344/api/v1/invoices', {
    data: { subscriptionId, emQue: primeiroDiaDoMesAnterior() },
  });
  expect(abertura.ok()).toBeTruthy();

  // Recarrega para a faixa de meses (`consultarMesesPagaveis`, Server
  // Component) refletir a invoice recem-criada.
  await page.reload();

  /*
   * A FAIXA parte do mes em aberto mais antigo ate corrente+6
   * (`mesesPagaveis`). So a invoice do mes PASSADO esta OPEN -- a cobranca
   * do mes CORRENTE nunca foi gerada (nem pela tela nem por esta chamada de
   * API) --, entao `indiceInicial` (`faixa-de-meses.tsx`) seleciona so o
   * primeiro chip por padrao: o em aberto. Os dois seguintes chegam como
   * NOT_OPENED ("Adiantado") -- setembro/26 e o mes CORRENTE, outubro/26 e
   * corrente+1. Clicar em cada um ESTENDE a selecao ate ali (Decisao 1 do
   * PI: nunca cria buraco) -- e o proprio uso do lote que abre a invoice
   * desses dois meses, ainda inexistentes.
   */
  await expect(page.getByText(/1 mês/i)).toBeVisible();

  const chips = page.getByRole('button', { name: /[a-z]{3}\/\d{2}/ });
  await expect(chips).toHaveCount(6); // vencido + corrente + corrente+1..+4 (teto de 6 meses adiantados)

  // Estende ate o mes CORRENTE (2º chip).
  await chips.nth(1).click();
  await expect(page.getByText(/2 meses/i)).toBeVisible();

  // Estende ate corrente+1 (3º chip) -- exatamente os 3 meses do brief:
  // vencido + corrente + 1 adiantado.
  await chips.nth(2).click();
  await expect(page.getByText(/3 meses/i)).toBeVisible();

  await page.getByTestId('forma-dinheiro').click();
  await page.getByRole('button', { name: /^Receber$/ }).click();

  await expect(page.getByText(/3 meses recebidos/i)).toBeVisible();

  // As 3 linhas na tabela de cobrancas, todas Pagas.
  await expect(page.getByTestId('tabela-de-cobrancas')).toBeVisible();
  const linhasPagas = page.getByTestId('tabela-de-cobrancas').getByText('Paga');
  await expect(linhasPagas).toHaveCount(3);

  // "Em dia": nada mais em aberto -- `SituacaoAtual` mostra `sem-pendencia`.
  await expect(page.getByTestId('sem-pendencia')).toBeVisible();
});
