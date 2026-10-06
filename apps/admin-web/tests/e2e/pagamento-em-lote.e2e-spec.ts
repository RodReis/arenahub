import { expect, test } from '@playwright/test';

import { cadastrarAluno } from './cadastro-de-aluno';
import { escolherPlano } from './cadastro-de-plano';

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
 * NAO RODAMOS `POST /billing/delinquency/apply` (o job de vencimento) neste
 * teste -- este golden path fica deliberadamente em ACTIVE, sem passar pelo
 * job. O caso SUSPENDED (entitlement suspenso pelo job de inadimplencia) tem
 * teste PROPRIO logo abaixo ("aluno suspenso por inadimplencia..."): ali
 * `page.tsx` PRECISA mostrar `FaixaDeMeses` mesmo com entitlement `SUSPENDED`
 * -- achado de revisao desta fatia (a versao anterior deste comentario
 * registrava isso como CONCERN porque `page.tsx` so liberava `FaixaDeMeses`
 * para `ACTIVE`; o fix mora em `page.tsx`/`painel-de-cobranca.tsx`,
 * `assinaturaParaPagamento`). A invoice deste teste fica `OPEN` com `dueAt`
 * genuinamente no passado -- o mesmo estado real de "venceu, ainda nao foi
 * processado pelo job" que a ausencia de agendador no MVP 2 comporta
 * (`billing.controller.ts`, comentario de `aplicarInadimplenciaAgora`).
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

/**
 * Formata para o `datetime-local` (`YYYY-MM-DDTHH:mm`, sem fuso nem segundos)
 * que `campo-inicio`/`campo-fim` esperam (`atribuir-plano.tsx`).
 */
function paraCampoDeData(data: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${data.getUTCFullYear()}-${pad(data.getUTCMonth() + 1)}-${pad(data.getUTCDate())}T${pad(data.getUTCHours())}:${pad(data.getUTCMinutes())}`;
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

  /*
   * Vigencia RELATIVA a agora, nao data fixa -- "teste com data fixa
   * envelhece" (ver memoria do projeto): uma data de fim fixa e uma
   * contagem de chips fixa coincidem hoje e divergem amanha, conforme "agora"
   * anda. Inicio 2 anos atras cobre o mes vencido que a invoice PASSADA
   * cria, mais 5 anos de folga; fim 5 anos a frente garante que `endsAt`
   * NUNCA e o fator que limita a faixa -- so o teto real de +6 meses
   * (`TETO_MESES_ADIANTADOS`, `meses-pagaveis.ts`) limita.
   */
  const agora = new Date();
  const inicioDaVigencia = paraCampoDeData(
    new Date(Date.UTC(agora.getUTCFullYear() - 2, agora.getUTCMonth(), 1, 6, 0)),
  );
  const fimDaVigencia = paraCampoDeData(
    new Date(Date.UTC(agora.getUTCFullYear() + 5, agora.getUTCMonth(), 1, 22, 0)),
  );

  await page.getByTestId('aba-plano').click();
  await page.getByRole('button', { name: /Atribuir plano|Alterar plano/ }).first().click();
  await escolherPlano(page, NOME_DO_PLANO_DO_SEED);
  await page.getByTestId('campo-inicio').fill(inicioDaVigencia);
  await page.getByTestId('campo-fim').fill(fimDaVigencia);
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
   * API) --, entao `selecaoInicial` (`faixa-de-meses.tsx`) seleciona so o
   * primeiro chip por padrao: o em aberto. Os dois seguintes chegam como
   * NOT_OPENED ("A vencer" e "Antecipar") -- o mes CORRENTE e corrente+1.
   * Clicar em cada um o ADICIONA a selecao (escolha livre, decisao
   * do PI de 01/10/2026) -- e o proprio uso do lote que abre a invoice desses
   * dois meses, ainda inexistentes.
   */
  await expect(page.getByText(/1 mês/i)).toBeVisible();

  /*
   * 8 chips = 1 vencido (mes anterior) + corrente + corrente+1..+6 (teto REAL
   * de `TETO_MESES_ADIANTADOS = 6`, `meses-pagaveis.ts`). Com `endsAt` 5 anos
   * a frente (acima), a vigencia da assinatura nunca e o fator limitante --
   * este numero prova o teto de verdade, e nao uma coincidencia entre dois
   * valores fixos (era o bug: a contagem antiga so batia por `endsAt` ter
   * sido fixado perto o bastante do `agora` de quando o teste foi escrito).
   */
  const chips = page.getByRole('button', { name: /^[a-z]{3}\/\d{2}/ });
  await expect(chips).toHaveCount(8);

  // Marca tambem o mes CORRENTE (2º chip).
  await chips.nth(1).click();
  await expect(page.getByText(/2 meses/i)).toBeVisible();

  // Marca tambem corrente+1 (3º chip) -- exatamente os 3 meses do brief:
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

  // Mes pago NUNCA reaparece como pagavel: a faixa recomeca na fatura seguinte
  // (aberta pelo lote para ancorar a vigencia) e vai ate corrente+6 -- 5 chips.
  await expect(chips).toHaveCount(5);
});

/**
 * Achado de revisao desta fatia (fix, nao Task 8 original) -- regressao de
 * entitlement-gating.
 *
 * ANTES desta fatia (commit 6c33233), "Receber no balcao" aparecia sempre
 * que havia invoice OPEN/OVERDUE, INDEPENDENTE do entitlement. A Task 7
 * moveu o pagamento (agora `FaixaDeMeses`) para dentro do mesmo bloco
 * `assinaturaAtiva` (so ACTIVE) que gera cobranca nova -- e um aluno
 * SUSPENDED por inadimplencia, exatamente quem mais precisa pagar para
 * voltar a ACTIVE, ficou sem NENHUM jeito de pagar por esta tela. Este
 * teste prova o fix: `FaixaDeMeses` PRECISA aparecer com entitlement
 * `SUSPENDED`, e pagar por ela PRECISA reativar a assinatura (o mesmo
 * `registrarPagamentoManual` que ja reativa PAST_DUE/SUSPENDED no sucesso,
 * comportamento pre-existente e correto, so agora alcancavel pela tela).
 *
 * RODAMOS `POST /billing/delinquency/apply` aqui (ao contrario do teste
 * acima) -- e exatamente o mecanismo que suspende o entitlement de verdade,
 * nao um atalho de teste. `graceDays: 5` do seed com `dueDay: 10` faz
 * qualquer mes passado inteiro ficar ha mais de 5 dias vencido, entao o job
 * marca a invoice OVERDUE, a assinatura PAST_DUE e o entitlement SUSPENDED
 * (`aplicar-inadimplencia.use-case.ts`).
 */
test('aluno suspenso por inadimplencia ve e usa a faixa de pagamento em lote', async ({ page }) => {
  await entrar(page);

  const nomeDoAluno = nomeUnico('Aluno Suspenso');

  await cadastrarAluno(page, {
    nome: nomeDoAluno,
    nascimento: '1990-05-20',
    cpf: gerarCpfValido(),
  });
  await page.getByTestId('abrir-ficha').click();
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}/);
  const idDoAluno = page.url().split('/students/')[1]?.split('/')[0] ?? '';

  // Mesma vigencia relativa do teste acima -- ver comentario la para o porque
  // de nunca usar data fixa.
  const agora = new Date();
  const inicioDaVigencia = paraCampoDeData(
    new Date(Date.UTC(agora.getUTCFullYear() - 2, agora.getUTCMonth(), 1, 6, 0)),
  );
  const fimDaVigencia = paraCampoDeData(
    new Date(Date.UTC(agora.getUTCFullYear() + 5, agora.getUTCMonth(), 1, 22, 0)),
  );

  await page.getByTestId('aba-plano').click();
  await page.getByRole('button', { name: /Atribuir plano|Alterar plano/ }).first().click();
  await escolherPlano(page, NOME_DO_PLANO_DO_SEED);
  await page.getByTestId('campo-inicio').fill(inicioDaVigencia);
  await page.getByTestId('campo-fim').fill(fimDaVigencia);
  await page.getByTestId('campo-motivo-atribuicao').fill('matricula para teste de aluno suspenso');
  await page.getByTestId('confirmar-atribuicao').click();
  await expect(page.getByTestId('plano-atribuido')).toBeVisible();

  await page.goto(`/students/${idDoAluno}/billing`);
  await expect(page.locator('#titulo-financeiro')).toContainText(/^Financeiro —/);

  const direitosAntes = await page.request.get(
    `http://localhost:3344/api/v1/students/${idDoAluno}/entitlements`,
  );
  expect(direitosAntes.ok()).toBeTruthy();
  const listaDeDireitosAntes = (await direitosAntes.json()) as {
    status: string;
    subscriptionId: string | null;
  }[];
  const subscriptionId = listaDeDireitosAntes.find(
    (d) => d.status === 'ACTIVE' && d.subscriptionId,
  )?.subscriptionId;
  expect(subscriptionId).toBeTruthy();

  // Invoice do mes PASSADO -- mesma receita do teste acima, mas aqui o ponto
  // e deixa-la vencer DE VERDADE via job, nao so simular `dueAt` no passado.
  const abertura = await page.request.post('http://localhost:3344/api/v1/invoices', {
    data: { subscriptionId, emQue: primeiroDiaDoMesAnterior() },
  });
  expect(abertura.ok()).toBeTruthy();

  // O JOB DE VERDADE: marca a invoice OVERDUE, a assinatura PAST_DUE e o
  // entitlement SUSPENDED (`aplicar-inadimplencia.use-case.ts`).
  const aplicacao = await page.request.post('http://localhost:3344/api/v1/billing/delinquency/apply');
  expect(aplicacao.ok()).toBeTruthy();

  const direitosDepois = await page.request.get(
    `http://localhost:3344/api/v1/students/${idDoAluno}/entitlements`,
  );
  const listaDeDireitosDepois = (await direitosDepois.json()) as {
    status: string;
    subscriptionId: string | null;
  }[];
  expect(listaDeDireitosDepois.some((d) => d.status === 'SUSPENDED' && d.subscriptionId === subscriptionId)).toBe(
    true,
  );

  await page.reload();

  /*
   * O PROPRIO REGRESSO: antes do fix, este bloco nao existia na tela --
   * `subscriptionIdParaPagamento` era `null` porque o entitlement estava
   * SUSPENDED, nao ACTIVE, e nem "Gerar cobranca do mes" nem `FaixaDeMeses`
   * apareciam. "Gerar cobranca do mes" CONTINUA ausente (SUSPENDED nao gera
   * cobranca nova) -- so `FaixaDeMeses` precisa estar de volta.
   */
  await expect(page.getByTestId('gerar-cobranca')).toHaveCount(0);

  const chips = page.getByRole('button', { name: /^[a-z]{3}\/\d{2}/ });
  await expect(chips.first()).toBeVisible();

  await page.getByTestId('forma-dinheiro').click();
  await page.getByRole('button', { name: /^Receber$/ }).click();

  await expect(page.getByText(/mês(es)? recebidos?/i)).toBeVisible();

  // O pagamento reativa a assinatura -- mesmo `registrarPagamentoManual` que
  // ja reativava PAST_DUE/SUSPENDED (comportamento pre-existente), agora
  // alcancavel por esta tela.
  const direitosFinal = await page.request.get(
    `http://localhost:3344/api/v1/students/${idDoAluno}/entitlements`,
  );
  const listaDeDireitosFinal = (await direitosFinal.json()) as {
    status: string;
    subscriptionId: string | null;
  }[];
  expect(listaDeDireitosFinal.some((d) => d.status === 'ACTIVE' && d.subscriptionId === subscriptionId)).toBe(
    true,
  );
});
