import type { Metadata } from 'next';

import {
  Ausente,
  Consequencia,
  Cpf,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  ProblemDetail,
  StateBadge,
  Telefone,
  TenantDateTime,
} from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { faturaEmDestaque, situacaoDeVencimento } from '../../../../src/billing/vencimento';
import { traduzir } from '../../../../src/operations/formatar';
import {
  MOTIVO_DA_SITUACAO,
  ROTULO_DE_ORIGEM,
  impedeAcesso,
  janelaLegivel,
  vigenteAgora,
} from '../../../../src/students/formatar';

/** Fuso FIXO, preservado de `dataLegivel` -- mesma divida das outras telas. */
const FUSO_PROVISORIO = 'America/Sao_Paulo';
import { FcClock, FcPortraitMode } from 'react-icons/fc';

import estilos from './ficha.module.css';

import { IconeBioimpedancia, IconePagamento } from '../acoes-do-aluno';
import { Abas } from '../../../../src/components/abas';
import { AlterarSituacao } from './alterar-situacao';
import { AtribuirPlano } from './atribuir-plano';
import { CobrancaRecorrente } from './cobranca-recorrente';
import { EditarCadastro } from './editar-cadastro';

export const metadata: Metadata = {
  title: 'Ficha do aluno — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Contato {
  type: string;
  value: string;
  isPrimary: boolean;
  label: string | null;
  relationship: string | null;
}

interface Endereco {
  postalCode: string;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  state: string;
}

interface Aluno {
  id: string;
  membershipNumber: string;
  fullName: string;
  birthDate: string;
  cpf: string | null;
  status: string;
  /** Por que está suspenso ou bloqueado. `null` em toda outra situação. */
  statusReason: string | null;
  /** O caso concreto, ao lado da razão fechada. Lido por extenso AQUI. */
  statusReasonNote: string | null;
  archivedAt: string | null;
  version: number;
  /*
    `rg`, `registeredSex`, `contacts` e `address` a API SEMPRE devolveu em
    `GET /students/:id` -- o DTO chama-se "o cadastro inteiro, para a ficha e
    para a edicao". Esta interface é que os ignorava, e por isso a ficha
    mostrava quatro campos de um cadastro de vinte e dois.
  */
  rg: string | null;
  registeredSex: string | null;
  contacts: Contato[];
  address: Endereco | null;
}

interface Janela {
  gymUnitId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

interface Entitlement {
  id: string;
  source: string;
  status: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  subscriptionId: string | null;
  /** Versão da assinatura de origem — o que a troca de plano precisa para cancelar. */
  subscriptionVersion: number | null;
  /** F56: modalidade do plano da assinatura. Nulo em cortesia. */
  planBillingMode: 'AVULSO' | 'ASSINATURA' | null;
  /** F56: já existe recorrência instalada no provedor? */
  recorrenciaAtiva: boolean;
  /** F56: preço vigente do plano — o valor que o aceite autoriza. */
  planCurrentPrice: { amountMinor: number; currency: string } | null;
  janelas: Janela[];
}

interface Plano {
  id: string;
  name: string;
  isActive: boolean;
}

interface Unidade {
  id: string;
  name: string;
}

interface Invoice {
  id: string;
  number: number;
  status: string;
  currency: string;
  totalMinor: number;
  dueAt: string;
  blockAt: string | null;
}

/** Resposta de `GET /students/:id/invoices` -- fuso da unidade do aluno (INV-144, ADR-019). */
interface InvoicesDoAluno {
  timezone: string;
  invoices: Invoice[];
}

/**
 * Ficha do aluno — `M1-AC-002` e `M1-AC-003`, Slice 1.2.
 *
 * Esta é a tela que fecha o aceite da fatia: *"a recepção cadastra aluno,
 * atribui plano e visualiza exatamente QUANDO e ONDE o acesso é válido"*. Por
 * isso a janela de horário aparece com dia e hora legíveis, e a unidade
 * aparece pelo nome — `gymUnitId` em UUID responderia "onde" só no papel.
 */
export default async function PaginaDaFicha({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Em série o operador esperaria cinco viagens; em paralelo, uma.
  const [
    respostaDoAluno,
    respostaDosDireitos,
    respostaDosPlanos,
    respostaDasUnidades,
    respostaDasInvoices,
  ] = await Promise.all([
    chamarApi<Aluno>(`/api/v1/students/${id}`),
    chamarApi<Entitlement[]>(`/api/v1/students/${id}/entitlements`),
    chamarApi<Plano[]>('/api/v1/plans'),
    chamarApi<Unidade[]>('/api/v1/units'),
    // F53 Task 12 -- aviso de vencimento. Falha aqui NAO derruba a ficha: o
    // aviso e um acrescimo a uma tela que ja respondia "quem e este aluno"
    // sem ele. Ver `invoiceEmDestaque` abaixo, que trata ausencia como "nada
    // a avisar", nao como aluno em dia.
    chamarApi<InvoicesDoAluno>(`/api/v1/students/${id}/invoices`),
  ]);

  if (!respostaDoAluno.ok || !respostaDoAluno.dados) {
    const codigo = respostaDoAluno.erro?.code ?? 'erro';

    return (
      <section aria-labelledby="titulo-ficha">
        <PageHeader id="titulo-ficha" title="Ficha do aluno" />
        <ProblemDetail
          testId={codigo === 'STUDENT_NOT_FOUND' ? 'aluno-nao-encontrado' : 'erro-da-ficha'}
          problem={{
            ...(respostaDoAluno.erro ?? {
              type: 'about:blank',
              status: 0,
              code: codigo,
              correlationId: '',
            }),
            title:
              codigo === 'STUDENT_NOT_FOUND'
                ? 'Aluno não encontrado nesta academia.'
                : `Não foi possível abrir a ficha (${codigo}).`,
          }}
        />
        <p>
          <a href="/students">Voltar para a lista de alunos</a>
        </p>
      </section>
    );
  }

  const aluno = respostaDoAluno.dados;

  // FALHA NÃO É LISTA VAZIA.
  //
  // Se a consulta de direitos cair, `?? []` faria a seção "Acesso agora"
  // dizer "sem direito de acesso vigente" -- para um aluno que talvez tenha
  // direito ativo. A recepção negaria a passagem, ou atribuiria um segundo
  // plano achando que não havia nenhum. Uma tela que responde a pergunta
  // errada com confiança é pior que uma tela que admite não saber.
  if (!respostaDosDireitos.ok || !respostaDosDireitos.dados) {
    return (
      <section aria-labelledby="titulo-ficha">
        <PageHeader id="titulo-ficha" title={aluno.fullName} />
        <ProblemDetail
          testId="erro-dos-direitos"
          problem={{
            ...(respostaDosDireitos.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível carregar os direitos de acesso deste aluno (${respostaDosDireitos.erro?.code ?? 'erro'}). Recarregue a página — enquanto isso, esta tela não consegue dizer se o acesso está válido.`,
          }}
        />
        <p>
          <a href="/students">Voltar para a lista de alunos</a>
        </p>
      </section>
    );
  }

  const direitos = respostaDosDireitos.dados;

  // Planos e unidades são acessórios: sem eles não dá para ATRIBUIR, mas o
  // que já existe continua legível. Cada bloco avisa a própria limitação, em
  // vez de derrubar a ficha inteira.
  const planos = respostaDosPlanos.dados ?? [];
  const unidades = respostaDasUnidades.dados ?? [];
  const unidadesIndisponiveis = !respostaDasUnidades.ok;
  const planosIndisponiveis = !respostaDosPlanos.ok;

  const nomeDaUnidade = (unidadeId: string): string =>
    unidades.find((unidade) => unidade.id === unidadeId)?.name ?? unidadeId;

  const agora = new Date();
  const vigentes = direitos.filter((direito) => vigenteAgora(direito, agora));
  const bloqueado = impedeAcesso(aluno.status);

  /*
   * Contato principal para a FICHA mostrar -- o telefone marcado como
   * primario, ou o primeiro que existir. `contacts` pode vir indefinido em
   * resposta antiga de cache, e `?? []` evita que a ficha inteira quebre por
   * causa de um campo de apoio.
   */
  const contatos = aluno.contacts ?? [];
  const telefonePrincipal =
    contatos.find((contato) => contato.type === 'PHONE' && contato.isPrimary)?.value ??
    contatos.find((contato) => contato.type === 'PHONE')?.value ??
    contatos.find((contato) => contato.type === 'WHATSAPP')?.value ??
    null;
  const email = contatos.find((contato) => contato.type === 'EMAIL')?.value ?? null;

  /*
   * ASSINATURA VIGENTE -- a que uma troca de plano precisa ENCERRAR.
   *
   * Vem do entitlement vigente que nasceu de assinatura: cortesia tem
   * `subscriptionId` nulo e nao e plano que se substitui. Sem isto o
   * formulario so sabe CRIAR, e atribuir um segundo plano deixa os dois
   * entitlements ativos -- a tela mostra o novo e a catraca honra o antigo.
   */
  const assinaturaVigente = vigentes
    .map((direito) =>
      direito.subscriptionId !== null && direito.subscriptionVersion !== null
        ? {
            subscriptionId: direito.subscriptionId,
            version: direito.subscriptionVersion,
            planName: null,
            billingMode: direito.planBillingMode ?? 'AVULSO',
            recorrenciaAtiva: direito.recorrenciaAtiva,
            planCurrentPrice: direito.planCurrentPrice,
          }
        : undefined,
    )
    .find((assinatura) => assinatura !== undefined);

  /*
   * F53 Task 12 -- a invoice em aberto/vencida MAIS ANTIGA e o fuso da
   * unidade, no mesmo criterio de `students/[id]/billing/page.tsx`: sem
   * fatura aberta, ou sem a consulta ter respondido, nao ha nada a avisar
   * aqui -- e a mesma regra que faz invoice PAGA nunca aparecer como
   * vencida (`situacaoDeVencimento`).
   */
  const invoices = respostaDasInvoices.dados?.invoices ?? [];
  const timezoneDaUnidade = respostaDasInvoices.dados?.timezone;
  /*
   * MESMA funcao que a tela de cobranca usa. A ficha avisa "vencida" sobre a
   * fatura que a outra tela manda receber -- se cada uma escolhesse por conta
   * propria, a recepcao leria aviso de uma fatura e cobraria outra.
   */
  const invoiceEmDestaque = faturaEmDestaque(invoices);
  const situacaoDoVencimento =
    invoiceEmDestaque && timezoneDaUnidade
      ? situacaoDeVencimento(invoiceEmDestaque, agora, timezoneDaUnidade)
      : 'EM_DIA';

  return (
    <section aria-labelledby="titulo-ficha">
      <PageHeader
        id="titulo-ficha"
        title={aluno.fullName}
        breadcrumb={<a href="/students">Voltar para a lista de alunos</a>}
      />


      <Abas
        rotulo="Seções da ficha"
        abas={[
          {
            id: 'informacao',
            rotulo: 'Informação',
            conteudo: (
              <>
            <dl className={estilos['dados']} data-testid="dados-do-aluno">
              <dt>Matrícula</dt>
              <dd data-testid="matricula">{aluno.membershipNumber}</dd>

              <dt>Nascimento</dt>
              <dd>
                <TenantDateTime iso={aluno.birthDate} timeZone={FUSO_PROVISORIO} format="date" />
              </dd>

              <dt>CPF</dt>
              {/*
                "não informado" preservado byte a byte: aqui a ficha usa a frase, nao
                o travessao do `Ausente`. Trocar mudaria texto de tela numa fatia que
                muda aparencia.
              */}
              <dd>{aluno.cpf ? <Cpf value={aluno.cpf} /> : 'não informado'}</dd>


              {/*
                CONTATO na ficha, e nao so na edicao: a recepcao liga para o aluno a
                partir daqui. O telefone vivia so no formulario de cadastro e na
                lista -- quem abria a ficha para resolver a excecao tinha que voltar
                para a listagem para achar o numero.
              */}
              <dt>Telefone</dt>
              {/* O proprio `Telefone` renderiza `Ausente` quando o numero e nulo. */}
              <dd data-testid="telefone-do-aluno">
                <Telefone numero={telefonePrincipal} testId="telefone-principal" />
              </dd>

              <dt>E-mail</dt>
              <dd data-testid="email-do-aluno">{email ? email : <Ausente />}</dd>
            </dl>

            {/*
              EDICAO em modal, ao lado dos dados que ela edita. Ver
              `EditarCadastro`: a ficha e tela de consulta, e dezoito campos
              abertos empurrariam "Acesso agora" para baixo da dobra em 1280px.

              O `<div>` existe para o botao nao esticar na largura da pagina --
              ver `.acoesDaIdentificacao`.
            */}
            <div className={estilos['acoesDaIdentificacao']}>
              <EditarCadastro
                studentId={aluno.id}
                nomeDoAluno={aluno.fullName}
                status={aluno.status}
                statusReason={aluno.statusReason}
                statusReasonNote={aluno.statusReasonNote}
                version={aluno.version}
                fullName={aluno.fullName}
                birthDate={aluno.birthDate}
                cpf={aluno.cpf}
                rg={aluno.rg}
                registeredSex={aluno.registeredSex}
                contacts={aluno.contacts ?? []}
                address={aluno.address}
              />
            </div>

            {/*
              FAIXA DE VENCIMENTO -- F53 Task 12, spec SPEC-053 §3.4.

              A CENA REAL: a recepcionista abre a ficha com a pessoa na frente e
              precisa ver, sem clicar em nada, quem esta com mensalidade vencida ou
              vencendo -- para cobrar na hora, e nao depois. `situacaoDeVencimento`
              e derivada de `dueAt`/`blockAt`/`status`, que a resposta de
              `/invoices` ja traz -- sem tabela nova, sem provedor, sem push.

              EM_DIA nao mostra nada: e o caso comum (mensalidade paga ou nada em
              aberto), e uma faixa que aparece sempre viraria ruido.
            */}
            {invoiceEmDestaque && situacaoDoVencimento !== 'EM_DIA' ? (
              <p role="status" data-testid="faixa-de-vencimento" data-situacao={situacaoDoVencimento}>
                Cobrança nº {invoiceEmDestaque.number} —{' '}
                <Money cents={invoiceEmDestaque.totalMinor} currency={invoiceEmDestaque.currency} />
                {', vencimento em '}
                <TenantDateTime
                  iso={invoiceEmDestaque.dueAt}
                  timeZone={timezoneDaUnidade ?? FUSO_PROVISORIO}
                  format="date"
                />
                <Consequencia tom="danger">
                  {' — '}
                  {situacaoDoVencimento === 'VENCE_EM_BREVE'
                    ? 'vence hoje'
                    : situacaoDoVencimento === 'BLOQUEIO_PROXIMO'
                      ? 'vencida, bloqueio de acesso próximo'
                      : 'vencida'}
                </Consequencia>
              </p>
            ) : null}

            {/*
              SITUAÇÃO DO CADASTRO vive em INFORMAÇÃO, não em Plano (decisão
              do PI, 24/08/2026): ela é atributo de QUEM a pessoa é -- ativo,
              suspenso, cancelado --, e não do que ela contratou. Plano trata
              de assinatura e direito de acesso.
            */}
            <section aria-labelledby="titulo-situacao" className={estilos['secao']}>
              <h2 id="titulo-situacao">Situação do cadastro</h2>

              {/*
                A SITUAÇÃO VIGENTE MORA AQUI, junto do que a altera -- decisão
                do PI em 01/09/2026.

                Ela ficava também na lista de leitura do topo, ao lado de
                matrícula e nascimento, e a ficha dizia a mesma coisa duas
                vezes na mesma tela. Um lugar só: quem lê a situação está a
                um clique de mudá-la, e não precisa procurar onde.

                Os três andam juntos porque respondem a mesma pergunta em
                sequência -- QUAL estado, o que ele CAUSA, e POR QUÊ.
              */}
              <p data-testid="situacao-do-aluno" className={estilos['situacaoVigente']}>
                <StateBadge machine="student" state={aluno.status} />
                {/*
                  A CONSEQUÊNCIA, não só o rótulo. "Bloqueado" sozinho não
                  avisa que a catraca nega MESMO com plano vigente -- e a
                  recepção atribuiria um plano esperando resolver.
                */}
                {bloqueado ? (
                  <Consequencia tom="danger" testId="acesso-impedido">
                    impede o acesso, mesmo com plano vigente
                  </Consequencia>
                ) : null}
              </p>

              {/*
                O motivo só existe em SUSPENDED/BLOCKED -- o `CHECK` do banco
                garante -- então não há travessão a mostrar no caso normal. É
                aqui que a observação é lida por extenso: na grid cabe só a
                razão fechada, com o texto no `title`.
              */}
              {aluno.statusReason ? (
                <p data-testid="motivo-da-situacao" className={estilos['motivoVigente']}>
                  {MOTIVO_DA_SITUACAO[aluno.statusReason] ?? aluno.statusReason}
                  {aluno.statusReasonNote ? ` — ${aluno.statusReasonNote}` : null}
                </p>
              ) : null}

              <AlterarSituacao
                studentId={aluno.id}
                situacaoAtual={aluno.status}
                version={aluno.version}
              />
            </section>

            <section aria-labelledby="titulo-mais" className={estilos['secao']}>
              <h2 id="titulo-mais">Mais sobre este aluno</h2>

              <ul className={estilos['portas']}>
                <li>
                  <a
                    className={estilos['porta']}
                    href={`/students/${aluno.id}/timeline`}
                    data-testid="link-timeline"
                  >
                    <span className={estilos['iconeDaPorta']} aria-hidden="true">
                      <FcClock size={22} aria-hidden />
                    </span>
                    <span className={estilos['rotuloDaPorta']}>Histórico administrativo</span>
                  </a>
                </li>
                <li>
                  <a
                    className={estilos['porta']}
                    href={`/students/${aluno.id}/biometrics`}
                    data-testid="link-biometria"
                  >
                    <span className={estilos['iconeDaPorta']} aria-hidden="true">
                      <FcPortraitMode size={22} aria-hidden />
                    </span>
                    <span className={estilos['rotuloDaPorta']}>Consentimento e biometria</span>
                  </a>
                </li>
                <li>
                  <a
                    className={estilos['porta']}
                    href={`/students/${aluno.id}/billing`}
                    data-testid="link-financeiro"
                  >
                    <span className={estilos['iconeDaPorta']} aria-hidden="true">
                      <IconePagamento />
                    </span>
                    <span className={estilos['rotuloDaPorta']}>Financeiro e cobranças</span>
                  </a>
                </li>
                <li>
                  <a
                    className={estilos['porta']}
                    href={`/students/${aluno.id}/health`}
                    data-testid="link-evolucao"
                  >
                    <span className={estilos['iconeDaPorta']} aria-hidden="true">
                      <IconeBioimpedancia />
                    </span>
                    <span className={estilos['rotuloDaPorta']}>Evolução corporal</span>
                  </a>
                </li>
              </ul>
            </section>
              </>
            ),
          },
          {
            id: 'plano',
            rotulo: 'Plano',
            conteudo: (
              <>
            {/*
              "ACESSO AGORA" SAIU DAQUI -- decisão do PI em 24/08/2026.

              A pergunta "essa pessoa entra agora?" é feita olhando a LISTA, com o
              aluno parado na porta, e não depois de abrir o cadastro. As duas
              coisas que a seção fazia foram para a grid: a situação já é coluna
              lá, e "Liberar a catraca manualmente" virou ícone de linha (a chave,
              em `AcoesDoAluno`).

              O que ficou aqui é o DETALHE -- quais janelas, de qual unidade, com
              qual vigência --, que é o que só faz sentido consultar na ficha.
            */}
            <section aria-labelledby="titulo-direitos" className={estilos['secao']}>
              <h2 id="titulo-direitos">Direitos de acesso</h2>

              {/*
                Sem a lista de unidades, `nomeDaUnidade` cai para o UUID. Dizer isso
                evita que a recepção leia um identificador técnico achando que é o
                nome de uma unidade que ela não conhece.
              */}
              {unidadesIndisponiveis ? (
                <ProblemDetail
                  testId="unidades-indisponiveis"
                  problem={{
                    ...(respostaDasUnidades.erro ?? {
                      type: 'about:blank',
                      status: 0,
                      code: 'erro',
                      correlationId: '',
                    }),
                    title:
                      'Não foi possível carregar os nomes das unidades. Onde deveria aparecer o nome, está o identificador interno.',
                  }}
                />
              ) : null}

              <DataTable
                testId="tabela-de-direitos"
                rows={direitos}
                rowKey={(direito) => direito.id}
                rowTestId={(direito) => `direito-${direito.id}`}
                caption="Direitos de acesso, do mais recente para o mais antigo"
                columns={[
                  {
                    key: 'situacao',
                    header: 'Situação',
                    role: 'state',
                    render: (direito) => (
                      <>
                        <StateBadge machine="entitlement" state={direito.status} />
                        {vigenteAgora(direito, agora) ? (
                          /*
                           * `Consequencia` e nao um `<span>` nu: e o mesmo padrao de
                           * `/students` -- o estado ja foi dito pelo badge, e isto
                           * responde a pergunta seguinte ("e dai?"). Era justamente
                           * este o `<span>` sem tratamento nenhum que o componente
                           * cita: gemeo visivel la, invisivel aqui.
                           *
                           * `tom="neutro"`: "vale agora" e a boa noticia. O `danger`
                           * fica reservado a consequencia que BARRA o aluno.
                           *
                           * O testid e o TEXTO seguem byte a byte -- o E2E procura
                           * `vigente-${id}`, e o espaco antes do travessao continua
                           * onde estava.
                           */
                          <Consequencia testId={`vigente-${direito.id}`}> — vale agora</Consequencia>
                        ) : null}
                      </>
                    ),
                  },
                  {
                    key: 'origem',
                    header: 'Origem',
                    /*
                     * `code`: origem e um ENUM curto e fechado ("Assinatura",
                     * "Cortesia") -- identifica a linha sem ser o que se procura.
                     * Nao e `state`, porque nao e situacao: um direito cancelado
                     * continua tendo vindo de uma assinatura.
                     *
                     * `ROTULO_DE_ORIGEM` FICA: origem do entitlement (ADR-009) e enum
                     * extensivel, nao maquina de estado -- o §7 nao a cobre.
                     */
                    role: 'code',
                    render: (d) => traduzir(ROTULO_DE_ORIGEM, d.source),
                  },
                  {
                    key: 'vigencia',
                    header: 'Vigência',
                    role: 'moment',
                    render: (d) => (
                      <>
                        <TenantDateTime iso={d.startsAt} timeZone={FUSO_PROVISORIO} format="date" /> até{' '}
                        <TenantDateTime iso={d.endsAt} timeZone={FUSO_PROVISORIO} format="date" />
                      </>
                    ),
                  },
                  {
                    key: 'onde',
                    header: 'Onde e quando vale',
                    /*
                     * `support`: uma lista de janelas por unidade e o texto mais longo
                     * da tabela, e e a coluna que deve ceder espaco -- com piso, para
                     * "Centro — seg a sex, 06:00 as 22:00" nao quebrar palavra a
                     * palavra.
                     */
                    role: 'support',
                    render: (direito) =>
                      direito.janelas.length === 0 ? (
                        <Ausente />
                      ) : (
                        <ul>
                          {direito.janelas.map((janela, indice) => (
                            <li
                              key={`${janela.gymUnitId}-${janela.dayOfWeek}-${janela.startMinute}-${indice}`}
                            >
                              {nomeDaUnidade(janela.gymUnitId)} — {janelaLegivel(janela)}
                            </li>
                          ))}
                        </ul>
                      ),
                  },
                  {
                    key: 'motivo',
                    header: 'Motivo',
                    /*
                     * SEM `role`, e nao `support`. O padrao caberia pelo tipo do dado
                     * (texto livre da API), mas `support` traz um PISO de 32ch, e
                     * "Onde e quando vale" ao lado ja o reivindica: duas colunas com
                     * 32ch de minimo somam 64ch numa tabela de cinco, e o piso que
                     * existe para impedir quebra em seis linhas passaria a EMPURRAR a
                     * vigencia e o estado para fora da primeira dobra.
                     *
                     * `reason` tambem e curto na pratica -- motivo de cortesia, nao
                     * frase operacional como `recommendedAction`. Sem role, a coluna
                     * cai no neutro de antes, que e o que ela precisa.
                     *
                     * Coluna de DADO, por isso `Ausente` e nao `AusenteDeAcao`: nao ha
                     * acao nenhuma nesta tabela.
                     */
                    render: (d) => d.reason ?? <Ausente />,
                  },
                ]}
                empty={
                  <EmptyState
                    testId="sem-direitos"
                    title="Nenhum direito de acesso registrado."
                    hint="Atribua um plano para criar o primeiro."
                  />
                }
              />
            </section>

            {/*
              F56 -- cobranca recorrente, ao lado do plano e nao numa aba
              propria: quem atribui o plano de assinatura e quem ativa a
              cobranca, na mesma conversa com o aluno.

              So aparece com assinatura vigente: sem plano nao ha o que cobrar.
            */}
            {assinaturaVigente ? (
              <section aria-labelledby="titulo-recorrencia" className={estilos['secao']}>
                <h2 id="titulo-recorrencia">Cobrança recorrente</h2>

                <CobrancaRecorrente
                  subscriptionId={assinaturaVigente.subscriptionId}
                  billingMode={assinaturaVigente.billingMode}
                  ativa={assinaturaVigente.recorrenciaAtiva}
                  amountMinor={assinaturaVigente.planCurrentPrice?.amountMinor ?? null}
                  currency={assinaturaVigente.planCurrentPrice?.currency ?? 'BRL'}
                  dueDay={null}
                />
              </section>
            ) : null}

            <section aria-labelledby="titulo-atribuir" className={estilos['secao']}>
              {/*
                O TÍTULO diz o que a ação faz de verdade. Aluno com plano vigente
                não recebe um segundo plano: o atual é encerrado e o novo entra no
                lugar -- ver `AtribuirPlano`.
              */}
              <h2 id="titulo-atribuir">{assinaturaVigente ? 'Alterar plano' : 'Atribuir plano'}</h2>

              {/*
                Lista de planos vazia por falha tem a mesma aparência de "nenhum
                plano cadastrado" -- e as duas pedem ações opostas: uma manda
                recarregar, a outra manda cadastrar plano.
              */}
              {planosIndisponiveis ? (
                <ProblemDetail
                  testId="planos-indisponiveis"
                  problem={{
                    ...(respostaDosPlanos.erro ?? {
                      type: 'about:blank',
                      status: 0,
                      code: 'erro',
                      correlationId: '',
                    }),
                    title: `Não foi possível carregar a lista de planos (${respostaDosPlanos.erro?.code ?? 'erro'}). Recarregue a página para atribuir um plano.`,
                  }}
                />
              ) : (
                <AtribuirPlano
                  studentId={aluno.id}
                  planos={planos}
                  impedido={bloqueado}
                  vigente={assinaturaVigente}
                />
              )}
            </section>

            {/*
              AS QUATRO PORTAS do aluno, como destino navegável e não como lista de
              links de rodapé. Numa tela que é o hub da recepção, o lugar para onde
              ela mais vai não pode ser o elemento menos visível da página.

              Cada uma leva o ícone que a MESMA ação já usa na listagem -- reuso,
              não desenho novo: dois glifos para o mesmo destino ensinariam que são
              destinos diferentes.
            */}
              </>
            ),
          },
        ]}
      />
    </section>
  );
}
