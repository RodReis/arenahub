import type { Metadata } from 'next';

import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Ausente,
  Consequencia,
  Identidade,
  MaskedCPF,
  Telefone,
  PageHeader,
  ProblemDetail,
  SelectField,
  StateBadge,
  TenantDateTime,
} from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { impedeAcesso } from '../../../src/students/formatar';
import estilos from './students.module.css';

/** Fuso FIXO, preservado de `dataLegivel` -- mesma divida das outras telas. */
const FUSO_PROVISORIO = 'America/Sao_Paulo';

export const metadata: Metadata = {
  title: 'Alunos — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Aluno {
  id: string;
  membershipNumber: string;
  fullName: string;
  birthDate: string;
  cpfMasked: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  phone: string | null;
  status: string;
  archivedAt: string | null;
  version: number;
}

interface Unidade {
  id: string;
  name: string;
}

const POR_PAGINA = 20;

/**
 * As sete situacoes, com o rotulo pt-BR que a tela ja usa.
 *
 * A ORDEM E A DO CICLO DE VIDA, nao alfabetica: interessado vira
 * experimental, que vira ativo, que pode ser suspenso ou bloqueado. Quem
 * procura "os bloqueados" acha no fim, onde o problema mora.
 *
 * Os rotulos repetem `STATE_LABELS` do design system de proposito: aquele
 * mapa e para BADGE (traduz o que veio da API), e este e para FILTRO (monta a
 * opcao antes de existir dado). Importar um no outro acoplaria a lista de
 * opcoes da tela a um mapa que existe para renderizar celula.
 */
const SITUACOES = [
  ['LEAD', 'Interessado'],
  ['TRIAL', 'Experimental'],
  ['ACTIVE', 'Ativo'],
  ['SUSPENDED', 'Suspenso'],
  ['BLOCKED', 'Bloqueado'],
  ['CANCELLED', 'Cancelado'],
  ['ARCHIVED', 'Arquivado'],
] as const;

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

      {/* GET, não Server Action: busca e filtro são navegação, e navegação vai na URL. */}
      <form className={estilos['filtro']} method="get" action="/students">
        {/*
          A largura extra vai no WRAPPER, e nao no `Field`: o componente
          espalha as props restantes no proprio `<input>`, entao um
          `className` ali estilizaria o controle em vez da coluna do flex.
        */}
        <div className={estilos['busca']}>
          <Field
            id="busca"
            name="q"
            type="search"
            label="Buscar por nome, matrícula ou contato"
            defaultValue={termo ?? ''}
            placeholder="Ex.: Maria, AP-2026-00000001, (41) 99999-0000"
          />
        </div>

        <SelectField id="situacao" name="status" label="Situação" defaultValue={situacao ?? ''}>
          <option value="">Todas</option>
          {SITUACOES.map(([chave, rotulo]) => (
            <option key={chave} value={chave}>
              {rotulo}
            </option>
          ))}
        </SelectField>

        {/*
          O filtro de unidade só aparece com MAIS DE UMA unidade. Numa
          academia de endereço único, ele seria um controle com uma opção só —
          ocupa espaço, sugere uma escolha que não existe e ainda esconde um
          modo de errar (filtrar pela única unidade e achar que filtrou algo).
        */}
        {unidades.length > 1 ? (
          <SelectField
            id="unidade"
            name="gymUnitId"
            label="Unidade"
            defaultValue={unidade ?? ''}
          >
            <option value="">Todas</option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </SelectField>
        ) : null}

        <Button type="submit" variant="outline" data-testid="buscar">
          Filtrar
        </Button>
      </form>

      {/*
        A busca não cobre CPF -- o documento é guardado só como hash, e
        procurar por ele exigiria rota nova. Dizer isso aqui evita a recepção
        digitar o CPF, não achar ninguém e concluir que o aluno não existe.
      */}
      <p className={estilos['aviso']} role="note" data-testid="aviso-de-busca">
        A busca não encontra por CPF. Use nome, número de matrícula ou telefone.
      </p>

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
             * NOME E CPF NA MESMA CELULA, empilhados -- como no mockup.
             *
             * Sao a mesma pergunta ("e esta pessoa?"), e quem confere
             * documento no balcao le os dois juntos. Em colunas separadas, o
             * olho atravessa a linha inteira entre uma metade e outra da
             * resposta.
             *
             * `MaskedCPF` recebe a mascara que a API ja devolve -- o painel
             * nunca ve o documento inteiro.
             *
             * SEM CPF, A LINHA NAO GANHA UM `—`. Cadastrar sem documento e o
             * caminho normal (INV-009/011), e nesta base 13 de 16 alunos nao
             * tem CPF: um travessao por linha viraria uma coluna de ausencia
             * sob os nomes, chamando atencao para o que NAO e problema. A
             * marca de ausencia continua existindo onde ela responde a uma
             * pergunta -- na ficha do aluno, onde a pessoa foi procurar o
             * documento.
             */
            role: 'identity',
            render: (aluno) => <Identidade nome={aluno.fullName} href={`/students/${aluno.id}`} />,
          },
          {
            key: 'matricula',
            sortKey: 'matricula',
            header: 'Matrícula',
            role: 'code',
            render: (aluno) => aluno.membershipNumber,
          },
          {
            key: 'cpf',
            header: 'CPF',
            role: 'code',
            /*
              Coluna propria, e nao linha de apoio sob o nome: empilhados, os
              dois criavam uma segunda linha em apenas 3 de 16 alunos --
              buracos irregulares sob os nomes. Em coluna, a ausencia e uma
              celula vazia como qualquer outra.
            */
            render: (aluno) =>
              aluno.cpfMasked === null ? <Ausente /> : <MaskedCPF masked={aluno.cpfMasked} />,
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
            render: (aluno) =>
              aluno.planName === null ? (
                <Ausente />
              ) : (
                <span className={estilos['plano']}>
                  <span className={estilos['nomeDoPlano']}>{aluno.planName}</span>
                  {aluno.subscriptionStatus === 'PAST_DUE' ? (
                    <Consequencia tom="danger">assinatura em atraso</Consequencia>
                  ) : null}
                </span>
              ),
          },
          {
            key: 'contato',
            header: 'Contato',
            /*
              A recepcao fala com o aluno por WhatsApp. Exibir o numero como
              texto significa copiar, abrir o aplicativo, colar e digitar --
              quatro passos com alguem esperando no balcao.
            */
            render: (aluno) => <Telefone numero={aluno.phone} />,
          },
          {
            key: 'nascimento',
            sortKey: 'nascimento',
            header: 'Nascimento',
            role: 'moment',
            render: (aluno) => (
              <TenantDateTime iso={aluno.birthDate} timeZone={FUSO_PROVISORIO} format="date" />
            ),
          },
          {
            key: 'situacao',
            header: 'Situação',
            role: 'state',
            render: (aluno) => (
              <>
                {/*
                  Todo estado tem TEXTO, cor é complemento. E o texto diz
                  a consequência: "Bloqueado" sozinho não avisa a recepção
                  de que a catraca vai negar.
                */}
                <StateBadge machine="student" state={aluno.status} />
                {impedeAcesso(aluno.status) ? (
                  <span className={estilos['consequencia']} data-testid={`sem-acesso-${aluno.id}`}>
                    sem acesso à catraca
                  </span>
                ) : null}
              </>
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
