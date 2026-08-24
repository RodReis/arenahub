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
  TenantDateTime,
  stateLabel,
} from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { situacaoDeVencimento } from '../../../../src/billing/vencimento';
import { traduzir } from '../../../../src/operations/formatar';
import {
  ROTULO_DE_ORIGEM,
  impedeAcesso,
  janelaLegivel,
  vigenteAgora,
} from '../../../../src/students/formatar';

/** Fuso FIXO, preservado de `dataLegivel` -- mesma divida das outras telas. */
const FUSO_PROVISORIO = 'America/Sao_Paulo';
import { AlterarSituacao } from './alterar-situacao';
import { AtribuirPlano } from './atribuir-plano';

export const metadata: Metadata = {
  title: 'Ficha do aluno — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Aluno {
  id: string;
  membershipNumber: string;
  fullName: string;
  birthDate: string;
  cpf: string | null;
  status: string;
  archivedAt: string | null;
  version: number;
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
   * F53 Task 12 -- a invoice em aberto/vencida MAIS ANTIGA e o fuso da
   * unidade, no mesmo criterio de `students/[id]/billing/page.tsx`: sem
   * fatura aberta, ou sem a consulta ter respondido, nao ha nada a avisar
   * aqui -- e a mesma regra que faz invoice PAGA nunca aparecer como
   * vencida (`situacaoDeVencimento`).
   */
  const invoices = respostaDasInvoices.dados?.invoices ?? [];
  const timezoneDaUnidade = respostaDasInvoices.dados?.timezone;
  const invoicesEmAberto = invoices.filter(
    (invoice) => invoice.status === 'OPEN' || invoice.status === 'OVERDUE',
  );
  const invoiceEmDestaque = invoicesEmAberto[invoicesEmAberto.length - 1] ?? null;
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

      <dl data-testid="dados-do-aluno">
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

        <dt>Situação</dt>
        {/*
          O E2E le o `innerText` deste `<dd>` e o compara com as opcoes do
          select de transicao. O `StateBadge` renderiza icone + rotulo, e o
          `innerText` continua devolvendo so o rotulo -- a comparacao segue
          valendo.
        */}
        <dd data-testid="situacao-do-aluno">
          <StateBadge machine="student" state={aluno.status} />
        </dd>
      </dl>

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
        A pergunta mais urgente da recepção -- "essa pessoa entra agora?" --
        respondida na primeira linha, em TEXTO. Uma tarja colorida sozinha
        deixaria de fora quem não distingue as cores e quem está de relance.
      */}
      <section aria-labelledby="titulo-acesso">
        <h2 id="titulo-acesso">Acesso agora</h2>

        {bloqueado ? (
          <p role="alert" data-testid="acesso-impedido">
            {/*
              `stateLabel` direto, nao `StateBadge`: aqui o rotulo entra NO MEIO
              da frase, e um badge com icone e fundo quebraria a leitura. O
              dicionario e o mesmo -- o que nao se repete e a fonte do texto.
            */}
            A situação{' '}
            <strong>{stateLabel('student', aluno.status)?.label ?? aluno.status}</strong> impede o
            acesso. A catraca vai negar mesmo que exista plano vigente.
          </p>
        ) : vigentes.length > 0 ? (
          <p role="status" data-testid="acesso-vigente">
            Tem direito de acesso vigente. A catraca ainda confere unidade e horário no momento da
            passagem.
          </p>
        ) : (
          <p role="status" data-testid="acesso-sem-direito">
            Sem direito de acesso vigente. Atribua um plano abaixo para liberar a catraca.
          </p>
        )}

        {/*
          A saida imediata, e so quando o acesso FALHA -- issue #99.

          Quem descobre aqui que a pessoa nao entra precisa agir agora, com ela
          parada na catraca. Antes, o caminho era voltar a barra lateral,
          escolher "Liberacao manual" e digitar o UUID num campo de texto livre
          -- que esta ficha ja tinha em maos e usava em tres links, sem oferecer
          este. A jornada principal do produto estava partida no meio.

          Nao aparece quando o acesso esta vigente: liberacao manual e ato
          excepcional e auditado (`access.override` e permissao propria), e
          oferece-la a quem ja pode passar convida ao uso banal.

          `encodeURIComponent` no nome porque ele vem do cadastro e pode ter
          acento, espaco ou `&`.
        */}
        {bloqueado || vigentes.length === 0 ? (
          <p>
            <a
              href={`/access/override?aluno=${aluno.id}&nome=${encodeURIComponent(aluno.fullName)}`}
              data-testid="link-liberacao-manual"
            >
              Liberar a catraca manualmente
            </a>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="titulo-direitos">
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

      <section aria-labelledby="titulo-atribuir">
        <h2 id="titulo-atribuir">Atribuir plano</h2>

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
          <AtribuirPlano studentId={aluno.id} planos={planos} impedido={bloqueado} />
        )}
      </section>

      <section aria-labelledby="titulo-situacao">
        <h2 id="titulo-situacao">Situação do cadastro</h2>
        <AlterarSituacao
          studentId={aluno.id}
          situacaoAtual={aluno.status}
          version={aluno.version}
        />
      </section>

      <section aria-labelledby="titulo-mais">
        <h2 id="titulo-mais">Mais sobre este aluno</h2>
        <ul>
          <li>
            <a href={`/students/${aluno.id}/timeline`} data-testid="link-timeline">
              Histórico administrativo
            </a>
          </li>
          <li>
            <a href={`/students/${aluno.id}/biometrics`} data-testid="link-biometria">
              Consentimento e biometria
            </a>
          </li>
          <li>
            <a href={`/students/${aluno.id}/billing`} data-testid="link-financeiro">
              Financeiro e cobranças
            </a>
          </li>
          <li>
            <a href={`/students/${aluno.id}/health`} data-testid="link-evolucao">
              Evolução corporal
            </a>
          </li>
        </ul>
      </section>
    </section>
  );
}
