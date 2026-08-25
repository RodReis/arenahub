/**
 * Seed de DEMONSTRACAO -- card [INFRA], issue #101, item 2.
 *
 *   pnpm db:demo
 *
 * O painel abria vazio: "Nenhum dispositivo cadastrado", "Nenhum evento no
 * periodo", lista de alunos em branco. Banco vazio, nao bug -- mas quem olha
 * a tela nao tem como saber a diferenca, e tela vazia nao deixa avaliar
 * decisao de layout, hierarquia ou estado.
 *
 * O QUE ELE CRIA: alunos, dispositivos e eventos de acesso (o que motivou o
 * arquivo, em 2026-08) e, desde 25/08/2026, o FATURAMENTO de tres
 * competencias -- invoices, itens e pagamentos confirmados. O painel
 * financeiro da F54 abria zerado pelo mesmo motivo que a tela de operacao
 * abria, e o bloco de evolucao por competencia so se consegue julgar com tres
 * pontos. Ver `COMPETENCIAS_FATURADAS`.
 *
 * SEPARADO do `seed.ts` de proposito, por decisao do PI. O seed base roda
 * tambem no `pretest:e2e` e no `pretest:integration`; se ele passasse a criar
 * aluno e evento, as suites herdariam dado que nao criaram -- e as que
 * afirmam `toHaveLength(0)` passariam a falhar, ou pior, a passar por acaso.
 * Demonstracao e para o olho humano; teste monta o proprio cenario.
 *
 * DEPENDE do seed base: tenant, unidade, dono e catalogo de planos vem de la.
 * O `pnpm db:demo` encadeia os dois.
 *
 * IDEMPOTENTE: reconhece o que ja criou pelo numero de matricula e nao
 * duplica. Rodar duas vezes deixa o banco igual a rodar uma.
 *
 * REGRA QUE NAO SE NEGOCIA: nenhum dado real de aluno aqui. Os nomes abaixo
 * sao inventados, e nenhum CPF e gravado -- o schema aceita `cpfHash` nulo, e
 * inventar CPF valido so para preencher campo criaria dado que parece real
 * sem precisar.
 */
import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

// Mesma ordem do `seed.ts`: carregar o `.env` ANTES do import que abre client.
carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { criarPrismaClient } from '../src/client.js';

const TENANT_SLUG = 'arena-positiva';

/** Prefixo das matriculas desta demonstracao -- e como o seed se reconhece. */
const PREFIXO = 'DEMO-';

/**
 * Doze alunos, volume escolhido pelo PI: enche a lista sem esconder nada.
 *
 * A variedade importa mais que o volume. Cada situacao que a recepcao ve no
 * dia a dia aparece pelo menos uma vez, porque lista so revela problema de
 * hierarquia visual quando ha estados diferentes lado a lado -- doze linhas
 * iguais nao mostrariam nada.
 *
 * `ACTIVE` domina a amostra porque domina uma academia de verdade; uma lista
 * meio bloqueada daria impressao errada do produto.
 */
const ALUNOS = [
  { nome: 'Ana Beatriz Moraes', nascimento: '1991-03-14', situacao: 'ACTIVE', plano: 'Programa Adultos e Idosos' },
  { nome: 'Bruno Carvalho Lima', nascimento: '1985-07-02', situacao: 'ACTIVE', plano: 'Clinica de Musculacao' },
  { nome: 'Carla Andrade Pinto', nascimento: '1996-11-23', situacao: 'ACTIVE', plano: 'Programa Adultos e Idosos' },
  { nome: 'Diego Ferreira Nunes', nascimento: '1978-01-30', situacao: 'ACTIVE', plano: 'Clinica de Musculacao' },
  { nome: 'Elaine Souza Tavares', nascimento: '2000-05-18', situacao: 'ACTIVE', plano: 'Plano Familia' },
  { nome: 'Fabio Rocha Menezes', nascimento: '1989-09-09', situacao: 'ACTIVE', plano: 'Plano Familia' },
  { nome: 'Gabriela Nunes Prado', nascimento: '1994-12-05', situacao: 'ACTIVE', plano: 'Programa Adultos e Idosos' },
  { nome: 'Henrique Alves Barros', nascimento: '1966-04-21', situacao: 'ACTIVE', plano: 'Programa Adultos e Idosos' },
  // Sem plano: a ficha precisa responder "entra agora?" com NAO, e a lista
  // precisa mostrar aluno que existe mas nao tem direito de acesso.
  { nome: 'Isabela Martins Cruz', nascimento: '1999-08-27', situacao: 'ACTIVE', plano: null },
  // Bloqueado COM plano em dia: e o caso que separa "tem direito" de "pode
  // entrar" -- quem nega e a situacao do cadastro, nao o financeiro.
  { nome: 'Joao Pedro Ramalho', nascimento: '1992-02-11', situacao: 'BLOCKED', plano: 'Clinica de Musculacao' },
  // Lead: cadastrado, ainda nao matriculado. Estado inicial do funil.
  { nome: 'Karina Lopes Vieira', nascimento: '2003-06-15', situacao: 'LEAD', plano: null },
  // Suspenso: matricula existe, direito parado.
  { nome: 'Lucas Teixeira Franco', nascimento: '1987-10-08', situacao: 'SUSPENDED', plano: null },
];

const DISPOSITIVO = {
  serial: 'DEMO-INNER-FIT-01',
  model: 'Inner Fit',
  firmware: '1.4.2',
};

/**
 * A catraca que o leitor comanda.
 *
 * Entra na demonstracao porque a tela de **liberacao manual** so lista
 * dispositivo de tipo `TURNSTILE` e status `ACTIVE` -- sem ela o formulario nem
 * renderiza, e a tela responde "Nenhuma catraca ativa cadastrada". Uma
 * demonstracao com leitor e sem catraca deixa inacessivel justamente a acao que
 * a recepcao usa quando alguem trava na porta.
 *
 * No mundo real sao dois equipamentos: o leitor reconhece, a catraca gira.
 */
const CATRACA = {
  serial: 'DEMO-CATRACA-01',
  model: 'Inner Turn',
  firmware: '2.0.1',
};

/**
 * O PC da academia que roda o edge-agent.
 *
 * Entra na demonstracao porque sem ele o painel estampa "Sem Edge, a catraca
 * nao decide nada" -- que e um alarme correto num banco vazio e enganoso numa
 * demonstracao. E o leitor pendura nele: no mundo real nao ha catraca decidindo
 * sozinha, e um dispositivo orfao mostraria uma topologia que nao existe.
 */
const EDGE = { code: 'DEMO-EDGE-MATRIZ', agentVersion: '0.1.0' };

/** Um dia em milissegundos -- para datar entitlement e evento sem magia solta. */
const UM_DIA = 24 * 60 * 60 * 1000;

/**
 * Ate quantos dias atras gerar passagem.
 *
 * O laco vai de `DIAS_DE_EVENTO` ate ZERO -- zero e HOJE, e hoje e o que
 * importa: sem periodo informado, a tela de eventos abre nas ultimas 24 h
 * (`PERIODO_PADRAO_HORAS` em `access-query.repository.ts`). Um seed que
 * parasse ontem encheria o banco e mesmo assim deixaria a tela dizendo
 * "Nenhum evento no periodo" -- exatamente o sintoma que ele existe para
 * resolver.
 */
const DIAS_DE_EVENTO = 7;

/**
 * Quantas competencias fechadas o faturamento de demonstracao cria.
 *
 * TRES, e o numero nao e arbitrario: o painel financeiro (F54) so desenha
 * comparacao de tendencia com tres pontos ou mais -- abaixo disso ele mostra
 * "dado insuficiente", que e o estado correto mas nao deixa avaliar o bloco.
 * Duas competencias produziriam justamente a tela que nao se consegue julgar.
 */
const COMPETENCIAS_FATURADAS = 3;

/**
 * Proporcao de faturas PAGAS por competencia, da mais antiga para a mais
 * recente.
 *
 * DECRESCENTE de proposito. Mes que fechou ha mais tempo teve mais chance de
 * ser quitado; o mes corrente ainda tem gente que vai pagar. Proporcao
 * constante faria as tres barras iguais e a serie viraria uma reta -- que e
 * exatamente o que o bloco de evolucao existe para NAO mostrar quando a
 * realidade e outra.
 */
const PAGAS_POR_COMPETENCIA = [92, 88, 74] as const;

/**
 * Mix de forma de pagamento, em faixas cumulativas de 0..99.
 *
 * PIX domina porque a academia ja recebe por la (ADR-032), cartao vem depois e
 * especie e a minoria do balcao. Um metodo so faria a quebra por forma de
 * pagamento do painel nao dizer nada.
 */
const FAIXA_PIX = 58;
const FAIXA_CARTAO = 87;

const UMA_HORA = 60 * 60 * 1000;

/**
 * Desfecho DETERMINISTICO a partir de um texto.
 *
 * Nao usa `Math.random()`: semente que muda a cada execucao faz a tela mudar
 * embaixo de quem esta avaliando layout, e dois desenvolvedores olhando "o
 * mesmo" banco veriam numeros diferentes. Hash simples (djb2) basta -- a
 * exigencia aqui e reprodutibilidade, nao qualidade criptografica.
 */
function sorteioEstavel(semente: string): number {
  let hash = 5381;

  for (let i = 0; i < semente.length; i += 1) {
    hash = ((hash << 5) + hash + semente.charCodeAt(i)) | 0;
  }

  return Math.abs(hash) % 100;
}

/** Primeiro dia da competencia, `N` meses antes do mes corrente, em UTC. */
function competenciaAtras(agora: Date, mesesAtras: number): Date {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - mesesAtras, 1));
}

async function semearDemonstracao(): Promise<void> {
  const db = criarPrismaClient();

  try {
    const tenant = await db.tenant.findUnique({ where: { slug: TENANT_SLUG } });

    if (!tenant) {
      throw new Error(
        `Tenant "${TENANT_SLUG}" nao existe. Rode o seed base antes: ` +
          'pnpm --filter @arenahub/database seed',
      );
    }

    const unidade = await db.gymUnit.findFirst({ where: { tenantId: tenant.id } });

    if (!unidade) {
      throw new Error('Nenhuma unidade no tenant. Rode o seed base antes.');
    }

    const planos = await db.plan.findMany({ where: { tenantId: tenant.id } });
    const planoPorNome = new Map(planos.map((plano) => [plano.name, plano]));

    const agora = new Date();

    const edge = await db.edgeNode.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: EDGE.code } },
      create: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        code: EDGE.code,
        status: 'ACTIVE',
        agentVersion: EDGE.agentVersion,
        lastHeartbeat: agora,
        clockOffsetMs: 0,
      },
      update: { lastHeartbeat: agora },
    });

    const dispositivo = await db.device.upsert({
      where: { tenantId_serial: { tenantId: tenant.id, serial: DISPOSITIVO.serial } },
      create: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        edgeNodeId: edge.id,
        kind: 'FACIAL_READER',
        model: DISPOSITIVO.model,
        firmware: DISPOSITIVO.firmware,
        serial: DISPOSITIVO.serial,
        status: 'ACTIVE',
        // Batimento recente: sem isso o painel mostra o leitor como mudo, que
        // e um alarme -- e alarme falso no seed treina a ignorar alarme.
        lastHeartbeat: agora,
        lastSyncAt: agora,
      },
      update: { edgeNodeId: edge.id, lastHeartbeat: agora, lastSyncAt: agora },
    });

    await db.device.upsert({
      where: { tenantId_serial: { tenantId: tenant.id, serial: CATRACA.serial } },
      create: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        edgeNodeId: edge.id,
        kind: 'TURNSTILE',
        model: CATRACA.model,
        firmware: CATRACA.firmware,
        serial: CATRACA.serial,
        status: 'ACTIVE',
        lastHeartbeat: agora,
        lastSyncAt: agora,
      },
      update: { edgeNodeId: edge.id, lastHeartbeat: agora, lastSyncAt: agora },
    });

    for (const [posicao, definicao] of ALUNOS.entries()) {
      const matricula = `${PREFIXO}${String(posicao + 1).padStart(3, '0')}`;

      const aluno = await db.student.upsert({
        where: { tenantId_membershipNumber: { tenantId: tenant.id, membershipNumber: matricula } },
        create: {
          tenantId: tenant.id,
          // Unidade de origem, obrigatoria desde a F45. A unidade vem do seed
          // base, conferida acima.
          gymUnitId: unidade.id,
          membershipNumber: matricula,
          fullName: definicao.nome,
          birthDate: new Date(definicao.nascimento),
          status: definicao.situacao as 'ACTIVE',
        },
        update: { fullName: definicao.nome, status: definicao.situacao as 'ACTIVE' },
      });

      const plano = definicao.plano === null ? undefined : planoPorNome.get(definicao.plano);

      if (!plano) continue;

      // Idempotencia: quem ja tem direito nao ganha um segundo.
      const jaTemDireito = await db.entitlement.findFirst({
        where: { tenantId: tenant.id, studentId: aluno.id },
        select: { id: true },
      });

      if (jaTemDireito) continue;

      const inicio = new Date(agora.getTime() - 30 * UM_DIA);
      const fim = new Date(agora.getTime() + 335 * UM_DIA);

      const assinatura = await db.subscription.create({
        data: {
          tenantId: tenant.id,
          studentId: aluno.id,
          planId: plano.id,
          status: 'ACTIVE',
          startsAt: inicio,
          endsAt: fim,
        },
      });

      // Mesma forma que `montarSnapshotDePolitica` produz em
      // `apps/api/src/modules/membership/domain/entitlement.ts`. Replicada, e
      // nao importada: o pacote de banco nao depende da API, e inverter essa
      // dependencia por um objeto de cinco campos custaria mais do que
      // resolve. Sem janela de horario -- acesso o dia todo, o caso simples.
      //
      // CUIDADO AO COPIAR ESTE TRECHO: `janelas: []` no snapshot dispensa
      // restricao de HORARIO, mas quem define as UNIDADES do direito sao as
      // linhas de `EntitlementUnitWindow` -- `access-projection.repository.ts`
      // monta `unitIds` so a partir delas, e `evaluate-access.ts` nega com
      // `WRONG_UNIT` se a unidade da catraca nao estiver na lista.
      //
      // ESTE SEED NAO GRAVA NENHUMA LINHA DE JANELA, entao os alunos de
      // demonstracao aparecem com direito ATIVO na ficha e seriam negados na
      // catraca com `WRONG_UNIT`. Para o painel, que le o direito, isso nao
      // atrapalha; para exercitar decisao de acesso, atrapalha. Fora do
      // escopo da F48 -- corrigir exige mexer no comportamento deste seed.
      const snapshot = {
        planId: plano.id,
        planName: plano.name,
        snapshotVersion: 1,
        gymUnitIds: [unidade.id],
        janelas: [],
      };

      await db.entitlement.create({
        data: {
          tenantId: tenant.id,
          studentId: aluno.id,
          source: 'SUBSCRIPTION',
          subscriptionId: assinatura.id,
          // Aluno bloqueado mantem o direito ATIVO: quem nega e o motor de
          // acesso, pela situacao do cadastro. Revogar aqui esconderia
          // justamente a distincao que a ficha precisa mostrar.
          status: 'ACTIVE',
          startsAt: inicio,
          endsAt: fim,
          policySnapshot: snapshot,
        },
      });
    }

    // Eventos de acesso, so para quem tem direito ativo E cadastro liberado.
    // Sem isso o painel operacional abre com "Nenhum evento no periodo" e nao
    // da para avaliar a tela.
    const comDireito = await db.student.findMany({
      where: {
        tenantId: tenant.id,
        membershipNumber: { startsWith: PREFIXO },
        status: 'ACTIVE',
        entitlements: { some: { status: 'ACTIVE' } },
      },
      select: { id: true },
    });

    // Idempotencia dos eventos: a chave `(edgeNodeId, idempotencyKey)` ja
    // garante que rodar de novo nao duplica, mas a checagem por presenca evita
    // o trabalho inteiro -- e evita erro de unicidade virar ruido no console.
    const jaHaEventos = await db.accessEvent.count({
      where: { tenantId: tenant.id, deviceId: dispositivo.id },
    });

    // O bloqueado tem plano em dia e MESMO ASSIM bate na porta fechada -- e o
    // caso que separa "tem direito" de "pode entrar". Sem uma negativa no
    // banco, o filtro "Resultado: Negado" da tela devolve vazio, a coluna de
    // motivo so mostra um valor, e o painel estampa "Negados: 0" -- tres
    // lugares onde a demonstracao esconderia metade do produto.
    const bloqueados = await db.student.findMany({
      where: {
        tenantId: tenant.id,
        membershipNumber: { startsWith: PREFIXO },
        status: 'BLOCKED',
      },
      select: { id: true },
    });

    let eventos = 0;

    if (jaHaEventos === 0) {
      for (let dia = DIAS_DE_EVENTO; dia >= 0; dia -= 1) {
        for (const [indice, aluno] of comDireito.entries()) {
          // Nem todo aluno treina todo dia -- presenca integral nao parece
          // academia, parece dado gerado.
          if ((dia + indice) % 3 === 0) continue;

          const quando = new Date(agora.getTime() - dia * UM_DIA);
          quando.setHours(6 + (indice % 14), (indice * 7) % 60, 0, 0);

          // Passagem no futuro nao existe. No dia de hoje o horario calculado
          // pode cair depois de agora -- ai o evento vira "daqui a 3 h" na
          // tela, que e pior que tela vazia: parece bug do produto.
          if (quando > agora) continue;

          await db.accessEvent.create({
            data: {
              tenantId: tenant.id,
              gymUnitId: unidade.id,
              deviceId: dispositivo.id,
              edgeNodeId: edge.id,
              studentId: aluno.id,
              outcome: 'ALLOW',
              reason: 'ACTIVE_ENTITLEMENT',
              policyVersion: '1',
              mode: 'ONLINE',
              method: 'FACIAL',
              occurredAt: quando,
              recognizedAt: quando,
              // `correlationId` rastreia a requisicao que gerou o evento.
              // Aqui nao houve requisicao: o valor declara a origem, para
              // quem investigar um evento nao procurar um log que nao existe.
              correlationId: `seed-demo-${String(dia)}-${String(indice)}`,
              // Deterministica: mesma execucao do seed produz a mesma chave,
              // entao rodar de novo nao acumula passagem duplicada.
              idempotencyKey: `seed-demo-${String(dia)}-${String(indice)}`,
              // `detail` guarda o payload cru que o Edge mandou. Aqui nao
              // houve leitura de verdade: a origem fica explicita para quem
              // investigar nao procurar uma passagem que nunca aconteceu.
              detail: { origem: 'seed-demo' },
            },
          });

          eventos += 1;
        }
      }

      // Tentativas NEGADAS do aluno bloqueado -- uma por dia, sempre no mesmo
      // horario: quem bate na porta fechada tende a insistir na mesma rotina,
      // e a repeticao e o que faz a recepcao reparar.
      //
      // `STUDENT_BLOCKED`, e nao `NO_ENTITLEMENT`: ele TEM direito ativo (a
      // regra de arquitetura no 1 -- pagamento nao controla acesso). Quem nega
      // e a situacao do cadastro, e o motivo na tela precisa dizer isso.
      for (const [indice, aluno] of bloqueados.entries()) {
        for (let dia = 3; dia >= 0; dia -= 1) {
          const quando = new Date(agora.getTime() - dia * UM_DIA);
          quando.setHours(7, 40, 0, 0);

          if (quando > agora) continue;

          await db.accessEvent.create({
            data: {
              tenantId: tenant.id,
              gymUnitId: unidade.id,
              deviceId: dispositivo.id,
              edgeNodeId: edge.id,
              studentId: aluno.id,
              outcome: 'DENY',
              reason: 'STUDENT_BLOCKED',
              policyVersion: '1',
              mode: 'ONLINE',
              method: 'FACIAL',
              occurredAt: quando,
              recognizedAt: quando,
              correlationId: `seed-demo-deny-${String(dia)}-${String(indice)}`,
              idempotencyKey: `seed-demo-deny-${String(dia)}-${String(indice)}`,
              detail: { origem: 'seed-demo' },
            },
          });

          eventos += 1;
        }
      }
    }

    /*
      FATURAMENTO DE DEMONSTRACAO -- o painel financeiro (F54) abria vazio.

      Mesmo motivo do resto deste arquivo: banco vazio nao e bug, mas quem
      olha a tela nao tem como saber a diferenca, e painel zerado nao deixa
      avaliar hierarquia, faixa de atraso nem quebra por forma de pagamento.

      COBRE TODAS AS ASSINATURAS ATIVAS DO TENANT, nao so os alunos `DEMO-`:
      os ~286 ativados da base do Pacto sao o volume real que o painel vai
      somar, e faturar so os doze de demonstracao produziria uma tela que nao
      se parece com a que o dono vai ver.
    */
    const assinaturasAtivas = await db.subscription.findMany({
      where: { tenantId: tenant.id, status: 'ACTIVE' },
      select: { id: true, studentId: true, planId: true },
    });

    /*
      Preco vigente por plano, carregado UMA vez. Uma consulta por assinatura
      seria N+1 num laco de quase trezentas.
    */
    const precos = await db.planPrice.findMany({
      where: { tenantId: tenant.id, validFrom: { lte: agora } },
      select: { planId: true, amountMinor: true },
      orderBy: { validFrom: 'desc' },
    });

    const precoDoPlano = new Map<string, number>();
    for (const preco of precos) {
      // `orderBy` decrescente: o primeiro que chega e o mais recente vigente.
      if (!precoDoPlano.has(preco.planId)) {
        precoDoPlano.set(preco.planId, preco.amountMinor);
      }
    }

    /*
      `number` e unico por tenant e nunca reaproveitado -- comeca depois do
      maior que ja existe, para conviver com invoice criada pela API.
    */
    const maiorNumero = await db.invoice.aggregate({
      where: { tenantId: tenant.id },
      _max: { number: true },
    });

    let proximoNumero = (maiorNumero._max.number ?? 0) + 1;
    let invoicesCriadas = 0;
    let pagamentosCriados = 0;

    for (let atras = COMPETENCIAS_FATURADAS; atras >= 1; atras -= 1) {
      const competencia = competenciaAtras(agora, atras);
      const venceEm = new Date(competencia);
      venceEm.setUTCDate(10);

      const percentualPago = PAGAS_POR_COMPETENCIA[COMPETENCIAS_FATURADAS - atras] ?? 85;

      for (const assinatura of assinaturasAtivas) {
        const valorMinor = precoDoPlano.get(assinatura.planId);

        // Plano sem preco vigente nao gera fatura -- e o caso do preco
        // agendado so para o mes que vem. Inventar valor aqui produziria
        // receita que o painel nao consegue explicar.
        if (valorMinor === undefined) continue;

        /*
          IDEMPOTENTE pela unique `(tenant, subscription, billing_period)` --
          INV-066, a regra que impede cobrar o aluno duas vezes pelo mesmo
          mes. Consultar antes de criar evita queimar numero de invoice a cada
          reexecucao.
        */
        const jaExiste = await db.invoice.findFirst({
          where: {
            tenantId: tenant.id,
            subscriptionId: assinatura.id,
            billingPeriod: competencia,
          },
          select: { id: true },
        });

        if (jaExiste) continue;

        const sorte = sorteioEstavel(`${assinatura.id}:${competencia.toISOString()}`);
        const pagou = sorte < percentualPago;

        /*
          Dia do pagamento espalhado ao longo da competencia: todo mundo
          pagando no mesmo dia faria a serie parecer lote automatico, e o
          recorte por janela do painel nao teria o que exercitar.
        */
        const pagoEm = pagou
          ? new Date(competencia.getTime() + (sorte % 26) * UM_DIA + 14 * UMA_HORA)
          : null;

        // A competencia mais recente ainda corre: o que nao foi pago esta
        // `OPEN`, nao `OVERDUE`. As anteriores ja venceram.
        const emAberto = atras === 1 ? 'OPEN' : 'OVERDUE';
        const mes = String(competencia.getUTCMonth() + 1).padStart(2, '0');
        const ano = String(competencia.getUTCFullYear());

        const invoice = await db.invoice.create({
          data: {
            tenantId: tenant.id,
            subscriptionId: assinatura.id,
            studentId: assinatura.studentId,
            billingPeriod: competencia,
            status: pagou ? 'PAID' : emAberto,
            number: proximoNumero,
            currency: 'BRL',
            subtotalMinor: valorMinor,
            totalMinor: valorMinor,
            dueAt: venceEm,
            paidAt: pagoEm,
            items: {
              create: {
                tenantId: tenant.id,
                description: `Mensalidade ${mes}/${ano}`,
                quantity: 1,
                unitAmountMinor: valorMinor,
                totalMinor: valorMinor,
              },
            },
          },
          select: { id: true },
        });

        proximoNumero += 1;
        invoicesCriadas += 1;

        if (pagou && pagoEm) {
          const metodoSorte = sorteioEstavel(`metodo:${invoice.id}`);
          const metodo =
            metodoSorte < FAIXA_PIX ? 'PIX' : metodoSorte < FAIXA_CARTAO ? 'CARD' : 'MANUAL';

          await db.payment.create({
            data: {
              tenantId: tenant.id,
              invoiceId: invoice.id,
              amountMinor: valorMinor,
              currency: 'BRL',
              method: metodo,
              status: 'CONFIRMED',
              paidAt: pagoEm,
            },
          });

          pagamentosCriados += 1;
        }
      }
    }

    console.info(
      `[demo] ${String(ALUNOS.length)} alunos, 1 leitor + 1 catraca, ${String(eventos)} eventos de acesso.`,
    );
    console.info(
      `[demo] faturamento: ${String(invoicesCriadas)} invoice(s) em ${String(COMPETENCIAS_FATURADAS)} competencias, ${String(pagamentosCriados)} pagamento(s) confirmado(s).`,
    );
    console.info('[demo] nenhum dado real -- nomes inventados, sem CPF.');
  } finally {
    // Sem `$disconnect` o pool segura o processo de pe -- o `client.ts` avisa.
    await db.$disconnect();
  }
}

try {
  await semearDemonstracao();
} catch (erro: unknown) {
  console.error('[demo] falhou:', erro);
  process.exitCode = 1;
}
