import type { Metadata } from 'next';

import {
  Button,
  DataTable,
  EmptyState,
  Ausente,
  Consequencia,
  Identidade,
  Telefone,
  PageHeader,
  ProblemDetail,
  StateBadge,
} from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { situacaoDeVencimento } from '../../../src/billing/vencimento';
import { MOTIVO_DA_SITUACAO, planoDaListagem } from '../../../src/students/formatar';
import { AcoesDoAluno } from './acoes-do-aluno';
import { BotaoDeLiberacao } from './botao-de-liberacao';
import { FiltroDeAlunos } from './filtro-de-alunos';
import estilos from './students.module.css';

export const metadata: Metadata = {
  title: 'Alunos — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Aluno {
  id: string;
  membershipNumber: string;
  /** Números do leitor, já sem repetidos. Vazio antes da primeira credencial. */
  deviceIds: string[];
  fullName: string;
  birthDate: string;
  planName: string | null;
  /** Origem do direito vigente quando o acesso nao vem de assinatura. */
  accessSource: string | null;
  subscriptionStatus: string | null;
  phone: string | null;
  status: string;
  /** Por que está suspenso ou bloqueado. `null` em toda outra situação. */
  statusReason: string | null;
  /** O caso concreto, ao lado da razão fechada. */
  statusReasonNote: string | null;
  archivedAt: string | null;
  version: number;
  /** Invoice em aberto/vencida mais antiga -- F53 Task 12, aviso de vencimento. */
  invoiceParaAviso: { status: string; dueAt: string; blockAt: string | null } | null;
  /** Fuso da unidade de origem do aluno (INV-144/ADR-019), para o mesmo aviso. */
  timezoneDaUnidade: string | null;
}

interface Unidade {
  id: string;
  name: string;
}

const POR_PAGINA = 20;

/**
 * Busca de alunos — `M1-AC-002`, Slice 1.2.
 *
 * BUSCA NA URL, não em estado de componente: a recepção manda o link para a
 * colega e chega no mesmo resultado, o botão voltar funciona, e a página
 * inteira continua Server Component, sem JavaScript para buscar.
 */
export default async function PaginaDeAlunos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;

  const texto = (chave: string): string | undefined => {
    const valor = parametros[chave];

    return typeof valor === 'string' && valor !== '' ? valor : undefined;
  };

  const termo = texto('q');
  const situacao = texto('status');
  const unidade = texto('gymUnitId');

  const consulta = new URLSearchParams();

  if (termo) consulta.set('q', termo);
  if (situacao) consulta.set('status', situacao);
  if (unidade) consulta.set('gymUnitId', unidade);

  const ordem = texto('ordem');
  const direcao = texto('direcao') === 'desc' ? 'desc' : 'asc';

  if (ordem) {
    consulta.set('ordem', ordem);
    consulta.set('direcao', direcao);
  }

  const cursor = texto('cursor');

  if (cursor) consulta.set('cursor', cursor);

  consulta.set('limit', String(POR_PAGINA));

  /*
   * As unidades vao JUNTO da listagem, nao em cascata.
   *
   * As duas chamadas nao dependem uma da outra, e `await` em sequencia
   * somaria os dois tempos de rede em cada carregamento da tela.
   *
   * A lista de unidades e do FILTRO: falhar ao busca-la nao pode derrubar a
   * pagina de alunos. Sem ela, o filtro de unidade simplesmente nao aparece,
   * e o resto da tela funciona como antes.
   */
  const [resposta, respostaDeUnidades] = await Promise.all([
    chamarApi<Aluno[]>(`/api/v1/students?${consulta.toString()}`),
    chamarApi<Unidade[]>('/api/v1/units'),
  ]);

  const unidades = respostaDeUnidades.ok ? (respostaDeUnidades.dados ?? []) : [];

  if (!resposta.ok) {
    return (
      <section aria-labelledby="titulo-alunos">
        <PageHeader id="titulo-alunos" title="Alunos" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para consultar alunos (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const alunos = resposta.dados ?? [];

  // F53 Task 12 -- um "agora" so, para toda a pagina: evita que duas linhas
  // avaliadas em milissegundos diferentes do mesmo carregamento decidam o
  // aviso de vencimento com relogios ligeiramente diferentes.
  const agora = new Date();

  /**
   * Próxima página pelo id do último aluno.
   *
   * A rota devolve array puro, sem `nextCursor` — a paginação se apoia no
   * último id. Página cheia é o único sinal de que pode haver mais: com menos
   * que o limite, não há próxima.
   */
  const proximaUrl = (): string => {
    const ultimo = alunos[alunos.length - 1];

    if (!ultimo || alunos.length < POR_PAGINA) return '';

    const proxima = new URLSearchParams();

    // Os filtros VAO JUNTO da proxima pagina. Sem isto, clicar em "Proximos"
    // com o filtro "Bloqueado" ligado devolveria a base inteira -- a pessoa
    // acharia que a tela perdeu o filtro sozinha.
    if (termo) proxima.set('q', termo);
    if (situacao) proxima.set('status', situacao);
    if (unidade) proxima.set('gymUnitId', unidade);
    proxima.set('cursor', ultimo.id);

    return `/students?${proxima.toString()}`;
  };

  const proxima = proximaUrl();

  return (
    <section aria-labelledby="titulo-alunos">
      <PageHeader
        id="titulo-alunos"
        title="Alunos"
        breadcrumb={<span>Cadastros</span>}
        actions={
          /*
            A ACAO PRIMARIA E UM BOTAO SOLIDO, e nao um link cru.
            "Cadastrar aluno" e o que a recepcao vem fazer nesta tela depois
            de nao achar a pessoa na busca -- com peso de link, competia em
            igualdade com os nomes dos alunos da tabela.

            `href` renderiza um `<a>` de verdade: quem navega tem de poder
            abrir em outra aba e copiar o endereco -- coisas que um
            `<button onClick>` nao devolve nem com JavaScript.
          */
          <Button href="/students/novo" data-testid="novo-aluno">
            Novo aluno
          </Button>
        }
      />

      {/*
        Busca automática, sem botão -- issue #118. O componente cliente
        escreve na URL sozinho (3+ caracteres, com atraso; situação e
        unidade na hora), e a página continua Server Component em volta
        dele.
      */}
      <FiltroDeAlunos
        unidades={unidades}
        termoInicial={termo ?? ''}
        situacaoInicial={situacao ?? ''}
        unidadeInicial={unidade ?? ''}
      />

      <DataTable
        testId="tabela-de-alunos"
        rows={alunos}
        rowKey={(aluno) => aluno.id}
        rowTestId={(aluno) => `aluno-${aluno.id}`}
        /*
          Ordenacao por URL, nao por estado de componente. Ordenar no cliente
          reordenaria as vinte linhas carregadas, nao as mil que existem -- e a
          recepcao acharia que viu o maior valor quando viu o maior da pagina.
          Pela URL, o servidor ordena a base inteira e o link e compartilhavel.

          O CURSOR SAI ao trocar a ordem: ele aponta para uma posicao na ordem
          ANTERIOR, e mante-lo pularia ou repetiria registros.
        */
        sort={{
          key: ordem ?? '',
          direction: direcao,
          href: (chave, sentido) => {
            const url = new URLSearchParams();

            if (termo) url.set('q', termo);
            if (situacao) url.set('status', situacao);
            if (unidade) url.set('gymUnitId', unidade);
            url.set('ordem', chave);
            url.set('direcao', sentido);

            return `/students?${url.toString()}`;
          },
        }}
        caption="Alunos, do cadastro mais recente para o mais antigo"
        columns={[
          {
            key: 'aluno',
            sortKey: 'nome',
            header: 'Aluno',
            /*
             * SÓ O NOME. O CPF saiu da grid por decisão do PI (01/09/2026,
             * issue #241) -- tanto a coluna própria quanto qualquer eco sob
             * o nome. O documento continua na ficha do aluno, que é onde
             * alguém vai procurá-lo.
             */
            role: 'identity',
            render: (aluno) => <Identidade nome={aluno.fullName} href={`/students/${aluno.id}`} />,
          },
          {
            key: 'catraca',
            header: 'ID da catraca',
            role: 'code',
            /*
              O NÚMERO DO EQUIPAMENTO NO LUGAR DA MATRÍCULA.

              A matrícula é identificador nosso, e a recepção não a usa para
              nada olhando a lista -- ela pergunta pelo nome. O número do
              leitor é o que ela precisa quando confere quem passou na
              catraca ou por que alguém não passou.

              A matrícula não sumiu: continua na ficha do aluno, que é onde
              se responde "quem é esta pessoa no nosso cadastro?".

              DOIS NÚMEROS APARECEM OS DOIS. Quem tem dois tem dois cartões
              vivos no leitor -- herança de linha duplicada no Pacto -- e é
              exatamente o caso que precisa ser visto para desativar o
              antigo. Esconder o segundo esconderia o problema.

              `Ausente` quando não há: aluno cadastrado pela recepção ainda
              não tem credencial, e isso é o caminho normal, não falha.
            */
            render: (aluno) =>
              aluno.deviceIds.length === 0 ? <Ausente /> : aluno.deviceIds.join(', '),
          },
          {
            key: 'plano',
            header: 'Plano',
            /*
              `code` e nao `support`: nome de plano e dado CURTO e fechado, e o
              piso de 32ch do apoio esticava a coluna, abrindo o vao que ficava
              entre PLANO e CONTATO. Apoio e para frase da API, nao para rotulo.
            */
            role: 'label',
            /*
              O PLANO E METADE DA RESPOSTA na recepcao ("ele tem Mensal Fit ou
              Anual Black?"), e ate esta fatia descobri-lo exigia abrir a ficha
              de cada aluno. A API passou a devolve-lo com a assinatura
              vigente.

              `Ausente` e nao "sem plano": interessado sem assinatura e o
              caminho normal do funil, nao uma falha -- e `—` com rotulo diz
              "nao ha", enquanto "sem plano" soa como diagnostico.
            */
            render: (aluno) => {
              /*
                NAO E SO `planName`: quem tem acesso por VINCULO (cortesia,
                funcionario, personal trainer) nao tem assinatura, e a coluna
                mostrava "—" para aluno cuja propria ficha exibia o direito
                ativo. Ver `planoDaListagem`.
              */
              const rotulo = planoDaListagem(aluno.planName, aluno.accessSource);

              if (rotulo === null) return <Ausente />;

              return (
                <span className={estilos['plano']}>
                  <span className={estilos['nomeDoPlano']}>{rotulo}</span>
                  {aluno.subscriptionStatus === 'PAST_DUE' ? (
                    <Consequencia tom="danger">assinatura em atraso</Consequencia>
                  ) : null}
                </span>
              );
            },
          },
          {
            key: 'contato',
            header: 'Contato',
            /*
              A recepcao fala com o aluno por WhatsApp. Exibir o numero como
              texto significa copiar, abrir o aplicativo, colar e digitar --
              quatro passos com alguem esperando no balcao.

              `label` e nao ausencia de papel: telefone tem largura previsivel
              e nao e frase da API. Sem papel declarado, esta era a UNICA
              coluna da tabela sem `inline-size: 1%` -- e por isso recebia
              TODA a sobra da linha, abrindo um vao de mais de cem pixels ate
              a data de nascimento. A coluna crescia sem ter o que mostrar.
            */
            role: 'label',
            render: (aluno) => <Telefone numero={aluno.phone} />,
          },
          {
            key: 'situacao',
            header: 'Situação',
            role: 'state',
            /*
              MARCA DE VENCIMENTO -- F53 Task 12, spec SPEC-053 §3.4.

              A CENA REAL: a recepcionista olha a LISTA de alunos, nao so a
              ficha de um, e precisa ver quem esta vencido ou vencendo sem
              abrir cada cadastro. `situacaoDeVencimento` e derivada de
              `invoiceParaAviso`/`timezoneDaUnidade`, que a lista ja traz --
              sem tabela nova, sem provedor, sem push.

              Sem invoice em aberto OU sem o fuso da unidade cadastrado, nao
              ha base para avisar -- a linha fica exatamente como antes desta
              fatia.
            */
            render: (aluno) => {
              const situacao =
                aluno.invoiceParaAviso && aluno.timezoneDaUnidade
                  ? situacaoDeVencimento(aluno.invoiceParaAviso, agora, aluno.timezoneDaUnidade)
                  : 'EM_DIA';

              return (
                <>
                  <StateBadge machine="student" state={aluno.status} />
                  {situacao !== 'EM_DIA' ? (
                    <Consequencia tom="danger" testId={`vencimento-${aluno.id}`}>
                      {situacao === 'VENCE_EM_BREVE'
                        ? ' — mensalidade vence hoje'
                        : situacao === 'BLOQUEIO_PROXIMO'
                          ? ' — mensalidade vencida, bloqueio próximo'
                          : ' — mensalidade vencida'}
                    </Consequencia>
                  ) : null}
                </>
              );
            },
          },
          {
            key: 'motivo',
            header: 'Motivo',
            /*
              `label`, como PLANO e CONTATO: rótulo curto e fechado, de uma
              lista de quatro. Sem `role` a coluna nasce neutra e toma
              largura livre -- foi o que espremeu os nomes na coluna ALUNO
              assim que esta entrou (visto na tela, não no teste).
            */
            role: 'label',
            /*
              COLUNA PRÓPRIA, e não texto colado no badge de situação
              (decisão do PI, 01/09/2026). Em coluna, os motivos se leem na
              VERTICAL: quem varre a lista atrás de "quantos estão parados
              por inadimplência" responde de relance, o que não dá para fazer
              com a razão embutida na célula ao lado.

              `statusReason` é nulo fora de SUSPENDED/BLOCKED -- o `CHECK` do
              banco garante --, e a maioria das linhas fica com `Ausente`.
              Isso é a informação certa: ausência de motivo em aluno ativo
              não é dado faltando, é a resposta.

              A OBSERVAÇÃO vai no `title`, não na célula: ela é texto livre de
              até 500 caracteres e esticaria a altura da linha de quem a
              escreveu por extenso. Quem não tem mouse lê o texto completo na
              ficha do aluno.
            */
            render: (aluno) =>
              aluno.statusReason ? (
                <span
                  data-testid={`motivo-${aluno.id}`}
                  {...(aluno.statusReasonNote ? { title: aluno.statusReasonNote } : {})}
                >
                  {MOTIVO_DA_SITUACAO[aluno.statusReason] ?? aluno.statusReason}
                </span>
              ) : (
                <Ausente />
              ),
          },
          {
            key: 'acao',
            header: 'Ação',
            role: 'actions',
            /*
              Ações como ÍCONE, não como botão de texto: com um rótulo por
              ação a coluna comia mais largura que o nome do aluno, e a
              tabela passava a rolar horizontalmente num monitor de 1280 --
              que é o monitor da recepção (`PRODUCT.md`).

              Cada ícone carrega `aria-label` e `title`: forma sozinha é
              canal único, e isso o PRODUCT.md proíbe. Ver `acoes-do-aluno`.

              A liberação é SÓ para BLOCKED (issue #118): é o status que o job
              de inadimplência aplica (M2-BR-007), sem oferecer "liberação
              financeira" para os 1.926 alunos importados (CANCELLED, sem
              cobrança real) nem para cancelamento por outro motivo.
            */
            /*
              O ATALHO DE OVERRIDE MANUAL SAIU DAQUI (decisão do PI,
              01/09/2026, issue #241). A chave que levava a
              `/access/override` deixou a grid; a rota continua existindo e
              é alcançada pelo menu. O cadeado ao lado é outra coisa --
              liberação FINANCEIRA -- e permanece.
            */
            render: (aluno) => (
              <AcoesDoAluno
                studentId={aluno.id}
                podeLiberar={aluno.status === 'BLOCKED'}
                liberacao={<BotaoDeLiberacao studentId={aluno.id} />}
              />
            ),
          },
        ]}
        {...(proxima ? { nextHref: proxima } : {})}
        empty={
          <EmptyState
            testId="sem-alunos"
            /*
              A mensagem separa "nao ha aluno" de "nao ha aluno ASSIM".
              Dizer "nenhum aluno cadastrado" a quem filtrou por "Bloqueado"
              afirmaria que a base esta vazia -- e o proximo passo seria
              cadastrar alguem que ja existe.
            */
            title={
              termo || situacao || unidade
                ? 'Nenhum aluno encontrado com esses filtros.'
                : 'Nenhum aluno cadastrado ainda.'
            }
            hint={
              termo || situacao || unidade
                ? 'Confira a grafia, amplie os filtros ou cadastre um novo aluno.'
                : 'Comece cadastrando o primeiro.'
            }
            action={<a href="/students/novo">Cadastrar aluno</a>}
          />
        }
      />
    </section>
  );
}
