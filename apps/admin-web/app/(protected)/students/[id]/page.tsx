import type { Metadata } from 'next';

import {
  Ausente,
  DataTable,
  EmptyState,
  MaskedCPF,
  PageHeader,
  ProblemDetail,
  StateBadge,
  TenantDateTime,
  stateLabel,
} from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
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
  cpfMasked: string | null;
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

  // Em série o operador esperaria quatro viagens; em paralelo, uma.
  const [respostaDoAluno, respostaDosDireitos, respostaDosPlanos, respostaDasUnidades] =
    await Promise.all([
      chamarApi<Aluno>(`/api/v1/students/${id}`),
      chamarApi<Entitlement[]>(`/api/v1/students/${id}/entitlements`),
      chamarApi<Plano[]>('/api/v1/plans'),
      chamarApi<Unidade[]>('/api/v1/units'),
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
        <dd>{aluno.cpfMasked ? <MaskedCPF masked={aluno.cpfMasked} /> : 'não informado'}</dd>

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
              render: (direito) => (
                <>
                  <StateBadge machine="entitlement" state={direito.status} />
                  {vigenteAgora(direito, agora) ? (
                    <span data-testid={`vigente-${direito.id}`}> — vale agora</span>
                  ) : null}
                </>
              ),
            },
            {
              key: 'origem',
              header: 'Origem',
              /*
               * `ROTULO_DE_ORIGEM` FICA: origem do entitlement (ADR-009) e enum
               * extensivel, nao maquina de estado -- o §7 nao a cobre.
               */
              render: (d) => traduzir(ROTULO_DE_ORIGEM, d.source),
            },
            {
              key: 'vigencia',
              header: 'Vigência',
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
        </ul>
      </section>
    </section>
  );
}
