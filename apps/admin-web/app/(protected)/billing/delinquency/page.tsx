import type { Metadata } from 'next';

import {
  BarrasDeFaixa,
  Button,
  DataTable,
  EmptyState,
  AcoesDaLinha,
  Identidade,
  Telefone,
  PageHeader,
  ProblemDetail,
  StateBadge,
  Tabs,
  TenantDateTime,
} from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import {
  linkDeCobranca,
  motivosDaLinha,
  situacaoVisivel,
} from '../../../../src/billing/inadimplencia';
import { BuscaDeAluno } from './busca-de-aluno';
import estilos from './delinquency.module.css';

export const metadata: Metadata = {
  title: 'Inadimplência e cobrança — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Linha {
  invoiceId: string;
  invoiceNumber: number;
  studentId: string;
  studentName: string;
  amountMinor: number;
  currency: string;
  dueAt: string;
  diasEmAtraso: number;
  situacao: string;
  telefone: string | null;
  liberadoAte: string | null;
  fusoDaUnidade: string;
}

interface Painel {
  resumo: {
    emAtrasoMinor: number;
    faturasVencidas: number;
    alunosInadimplentes: number;
    bloqueados: number;
    taxaDeInadimplencia: number | null;
  };
  faixas: { rotulo: string; minorTotal: number; quantidade: number }[];
  linhas: Linha[];
  proximoCursor: string | null;
}

/** Linha da aba "Pagantes" -- espelho de `Linha`, sem os campos de divida. */
interface LinhaPaga {
  invoiceId: string;
  invoiceNumber: number;
  studentId: string;
  studentName: string;
  amountMinor: number;
  currency: string;
  paidAt: string;
  telefone: string | null;
  fusoDaUnidade: string;
}

interface PainelDePagos {
  total: number;
  linhas: LinhaPaga[];
  proximoCursor: string | null;
}

/**
 * Cor por SEVERIDADE, nao por variedade.
 *
 * A escala vai de neutro a perigo conforme a divida envelhece: quem esta na
 * carencia AINDA ENTRA na academia, e pinta-lo de vermelho faria a recepcao
 * barrar por engano. O que passou de 30 dias e perda provavel.
 *
 * TOKENS DE ESTADO, nao de accent: `--ah-accent-*` nao acompanha o seed do
 * tenant (regra 2 do DS §11), e a paleta do grafico sairia errada na academia
 * que tem outra cor de marca. A lint pegou isto, e estava certa.
 */
const COR_DA_FAIXA: Readonly<Record<string, string>> = {
  'Em carência': '--ah-state-neutral',
  'Até 15 dias': '--ah-state-warning',
  '16 a 30 dias': '--ah-state-risk',
  'Mais de 30 dias': '--ah-state-danger',
};

/**
 * Rotulo da barra em CONTAGEM de fatura, nunca em dinheiro.
 *
 * Decisao do PI: esta tela e da recepcao, que decide se cobra e como -- nao
 * precisa ver quanto dinheiro esta parado. Valor em R$ fica exclusivo do
 * painel financeiro gerencial (`/billing/summary`), que tem permissao propria
 * (`billing.dashboard`) por este mesmo motivo.
 */
function faturasLegivel(quantidade: number): string {
  return quantidade === 1 ? '1 fatura' : `${String(quantidade)} faturas`;
}

/**
 * Busca e paginacao por aba -- parametros de URL PROPRIOS e prefixados
 * (`qInad`/`cursorInad`, `qPag`/`cursorPag`), pedido do PI. As duas abas
 * ficam montadas ao mesmo tempo (`Tabs` do DS), entao um par de parametros
 * unico faria a URL de uma aba interferir na outra.
 */
export default async function InadimplenciaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;

  const texto = (chave: string): string | undefined => {
    const valor = parametros[chave];

    return typeof valor === 'string' && valor !== '' ? valor : undefined;
  };

  const qInad = texto('qInad');
  const cursorInad = texto('cursorInad');
  const qPag = texto('qPag');
  const cursorPag = texto('cursorPag');

  const consultaInad = new URLSearchParams();
  if (qInad) consultaInad.set('q', qInad);
  if (cursorInad) consultaInad.set('cursor', cursorInad);

  const consultaPag = new URLSearchParams();
  if (qPag) consultaPag.set('q', qPag);
  if (cursorPag) consultaPag.set('cursor', cursorPag);

  const [respostaInadimplencia, respostaPagos] = await Promise.all([
    chamarApi<Painel>(`/api/v1/billing/delinquency?${consultaInad.toString()}`),
    chamarApi<PainelDePagos>(`/api/v1/billing/paid-invoices?${consultaPag.toString()}`),
  ]);

  if (!respostaInadimplencia.ok || !respostaInadimplencia.dados) {
    return (
      <section aria-labelledby="titulo-inadimplencia">
        <PageHeader id="titulo-inadimplencia" title="Inadimplência e cobrança" />
        <ProblemDetail
          testId="erro-de-inadimplencia"
          problem={{
            ...(respostaInadimplencia.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para consultar a cobrança (${respostaInadimplencia.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const { resumo, faixas, linhas, proximoCursor: proximoCursorInad } = respostaInadimplencia.dados;
  /*
   * A aba de pagantes falhando NAO derruba a tela inteira -- a fila de
   * cobranca (que ja chegou) e a resposta mais urgente das duas. Uma lista
   * vazia com erro proprio dentro da aba e melhor que a pagina inteira virar
   * `ProblemDetail` por causa da metade que importa menos agora.
   */
  const linhasPagas = respostaPagos.ok ? (respostaPagos.dados?.linhas ?? []) : [];
  const proximoCursorPag = respostaPagos.ok ? (respostaPagos.dados?.proximoCursor ?? null) : null;
  const totalPagos = respostaPagos.ok ? (respostaPagos.dados?.total ?? 0) : 0;

  /*
   * OS LINKS DE PAGINACAO, um par por aba -- mesma logica de `/students`
   * (issue #263): "Proximos" pelo `proximoCursor` que o backend devolveu, e
   * "Primeira pagina" so quando ha cursor ativo (na primeira pagina nao ha
   * para onde voltar). Os OUTROS parametros da URL (busca da propria aba, e
   * os da aba IRMA) precisam sobreviver ao clique -- e e por isso que a URL
   * inteira e reconstruida a partir de `parametros`, nao so do que muda.
   */
  const linkDePagina = (
    ajustes: Record<string, string | undefined>,
  ): string => {
    const url = new URLSearchParams();

    for (const [chave, valor] of Object.entries(parametros)) {
      if (typeof valor === 'string' && valor !== '') url.set(chave, valor);
    }

    for (const [chave, valor] of Object.entries(ajustes)) {
      if (valor === undefined) url.delete(chave);
      else url.set(chave, valor);
    }

    const consulta = url.toString();

    return consulta ? `/billing/delinquency?${consulta}` : '/billing/delinquency';
  };

  const proximaInad = proximoCursorInad ? linkDePagina({ cursorInad: proximoCursorInad }) : '';
  const primeiraInad = cursorInad ? linkDePagina({ cursorInad: undefined }) : '';
  const proximaPag = proximoCursorPag ? linkDePagina({ cursorPag: proximoCursorPag }) : '';
  const primeiraPag = cursorPag ? linkDePagina({ cursorPag: undefined }) : '';

  return (
    <section aria-labelledby="titulo-inadimplencia">
      <PageHeader
        id="titulo-inadimplencia"
        title="Inadimplência e cobrança"
        breadcrumb={<span>Receita</span>}
      />

      {/*
        BLOCO 1 -- O GESTOR (leia-se: quem recebe a tela, a recepcao).

        SEM VALOR EM R$, por decisao do PI: quem opera esta tela decide SE
        cobra e COMO, nao precisa ver quanto dinheiro esta parado -- isso e
        do painel financeiro gerencial, que tem permissao propria
        (`billing.dashboard`) exatamente para separar essas duas audiencias.
        O numero grande virou a CONTAGEM de faturas vencidas, e o grafico
        virou contagem por faixa em vez de valor por faixa.
      */}
      <section className={estilos['visaoDoGestor']} aria-label="Visão geral da inadimplência">
        <div className={estilos['dinheiro']}>
          <p className={estilos['rotulo']}>Faturas vencidas agora</p>
          <p className={estilos['valorGigante']}>{resumo.faturasVencidas}</p>

          <dl className={estilos['secundarios']}>
            <div>
              <dt>Sem acesso</dt>
              <dd>{resumo.bloqueados}</dd>
            </div>
            <div>
              <dt>Taxa</dt>
              <dd>
                {/*
                  `—` e nao `0%` quando nao ha assinatura pagante: academia sem
                  aluno nao tem inadimplencia zero, tem uma taxa que nao existe.
                */}
                {resumo.taxaDeInadimplencia === null
                  ? '—'
                  : `${String(resumo.taxaDeInadimplencia).replace('.', ',')}%`}
              </dd>
            </div>
          </dl>
        </div>

        <div className={estilos['composicao']}>
          <h2 className={estilos['tituloDoBloco']}>Faturas por faixa de atraso</h2>
          {/*
            NAO E EVOLUCAO MENSAL, e a escolha e deliberada: o sistema tem UM
            mes de dado. Uma linha temporal com um ponto so nao informa nada, e
            desenha-la com meses vazios antes faria a curva subir do zero,
            sugerindo uma piora que nao aconteceu.

            A composicao responde a pergunta operacional: quantas faturas ja
            estao velhas demais para voltar sem escalar a cobranca.
          */}
          <BarrasDeFaixa
            testId="faixas-de-atraso"
            descricao="Quantidade de faturas por faixa de atraso"
            faixas={faixas.map((faixa) => ({
              rotulo: faixa.rotulo,
              valor: faixa.quantidade,
              tokenDeCor: COR_DA_FAIXA[faixa.rotulo] ?? '--ah-text-muted',
              valorLegivel: faturasLegivel(faixa.quantidade),
            }))}
          />
        </div>
      </section>

      {/*
        BLOCO 2 -- A RECEPCAO, em abas.

        "Inadimplentes" e a aba padrao: e a fila que a recepcao trabalha o dia
        inteiro, "Pagantes" e consulta eventual ("esse aluno ja pagou?"). As
        duas ficam montadas (ver docblock de `Tabs`), entao a segunda chamada
        de API acima nao atrasa a primeira renderizacao.
      */}
      <Tabs
        testId="abas-de-cobranca"
        label="Situação financeira dos alunos"
        abas={[
          {
            id: 'inadimplentes',
            label: 'Inadimplentes',
            /*
              ALUNO, nao fatura (issue #416): a aba vizinha conta aluno
              distinto, e contar fatura aqui fazia as duas medirem unidades
              diferentes lado a lado. O card do topo continua em
              `faturasVencidas` -- la a pergunta e quantas faturas.
            */
            contador: resumo.alunosInadimplentes,
            content: (
              <FilaDeCobranca
                linhas={linhas}
                termoDeBusca={qInad ?? ''}
                prevHref={primeiraInad}
                nextHref={proximaInad}
              />
            ),
          },
          {
            id: 'pagantes',
            label: 'Pagantes',
            contador: totalPagos,
            content: (
              <FilaDePagos
                linhas={linhasPagas}
                termoDeBusca={qPag ?? ''}
                prevHref={primeiraPag}
                nextHref={proximaPag}
              />
            ),
          },
        ]}
      />
    </section>
  );
}

/**
 * A fila de cobranca -- extraida da pagina para poder ser uma aba do `Tabs`
 * sem inchar o corpo de `InadimplenciaPage`.
 *
 * Ordenada por URGENCIA (valor x dias), nao por data: quem trabalha esta
 * fila tem meia hora entre um aluno e outro e precisa saber por onde
 * COMECAR, nao quem venceu primeiro.
 */
function FilaDeCobranca({
  linhas,
  termoDeBusca,
  prevHref,
  nextHref,
}: {
  linhas: Linha[];
  termoDeBusca: string;
  prevHref: string;
  nextHref: string;
}) {
  return (
    <>
      <h2 className={estilos['tituloDaFila']}>
        Fila de cobrança
        <span className={estilos['apoioDoTitulo']}>maior valor parado há mais tempo primeiro</span>
      </h2>

      <BuscaDeAluno
        prefixo="qInad"
        termoInicial={termoDeBusca}
        label="Buscar aluno inadimplente"
        testId="busca-inadimplentes"
      />

      <DataTable
        testId="tabela-de-inadimplencia"
        rows={linhas}
        rowKey={(linha) => linha.invoiceId}
        rowTestId={(linha) => `fatura-${linha.invoiceId}`}
        caption="Faturas vencidas em aberto, da mais urgente para a menos urgente"
        {...(prevHref ? { prevHref, prevLabel: 'Primeira página' } : {})}
        {...(nextHref ? { nextHref } : {})}
        columns={[
          {
            key: 'aluno',
            header: 'Aluno',
            role: 'identity',
            /*
              NOME, TELEFONE E MOTIVOS numa celula so. Sao a mesma pergunta --
              "quem e, como falo com ela, e por que esta aqui?" -- e em colunas
              separadas o olho atravessa a linha inteira entre uma metade e
              outra da resposta. Mesma correcao feita na lista de alunos (F45).

              `Identidade` do DS substitui o `.identidade` local, que era o
              MESMO bloco escrito em `/students` com gap e padding levemente
              diferentes. Os CHIPS DE MOTIVO ficam: eles sao especificos desta
              fila -- respondem "por que esta pessoa aparece aqui?", pergunta
              que nenhuma outra tabela do painel faz.
            */
            render: (linha) => (
              <div className={estilos['celulaDoAluno']}>
                <Identidade
                  nome={linha.studentName}
                  secundario={
                    linha.telefone === null ? (
                      <span className={estilos['semTelefone']}>sem telefone cadastrado</span>
                    ) : (
                      /*
                        `Telefone` do DS: mostra o numero E abre a conversa. A
                        mensagem vem daqui porque e desta tela -- "lembrando da
                        fatura 8222" nao serve para a ficha do aluno.
                      */
                      <Telefone
                        numero={linha.telefone}
                        mensagem={mensagemDeCobranca(linha.studentName, linha.invoiceNumber)}
                      />
                    )
                  }
                />

                <ul className={estilos['motivos']}>
                  {motivosDaLinha(linha).map((motivo) => (
                    <li key={motivo} className={estilos['motivo']}>
                      {motivo}
                    </li>
                  ))}
                </ul>
              </div>
            ),
          },
          {
            key: 'fatura',
            header: 'Fatura',
            role: 'code',
            render: (linha) => (
              <div className={estilos['fatura']}>
                <span className={estilos['numero']}>{linha.invoiceNumber}</span>
                <span className={estilos['vencimento']}>
                  venceu em{' '}
                  <TenantDateTime iso={linha.dueAt} timeZone={linha.fusoDaUnidade} format="date" />
                </span>
              </div>
            ),
          },
          {
            key: 'acesso',
            header: 'Acesso',
            role: 'state',
            render: (linha) => (
              <StateBadge machine="delinquencyAccess" state={situacaoVisivel(linha)} />
            ),
          },
          {
            key: 'acoes',
            header: 'Ações',
            role: 'actions',
            /*
              PADRAO DO MOCKUP DE RETENCAO: secundario discreto + primario
              solido. A acao que a tela existe para provocar e cobrar, e ela
              precisa PARECER a acao -- dois botoes de peso igual fazem a
              pessoa escolher em vez de agir.
            */
            render: (linha) => (
              <AcoesDaLinha>
                <Button variant="ghost" href={`/students/${linha.studentId}`}>
                  Ver aluno
                </Button>

                {linha.telefone === null ? (
                  /*
                    SEM TELEFONE, A ACAO E CADASTRAR UM. A versao anterior
                    escondia o botao, deixando a linha com uma acao so e um
                    buraco que nao explicava nada.
                  */
                  <Button variant="outline" href={`/students/${linha.studentId}`}>
                    Cadastrar telefone
                  </Button>
                ) : (
                  <Button
                    variant="solid"
                    href={
                      linkDeCobranca(linha.telefone, linha.studentName, linha.invoiceNumber) ?? '#'
                    }
                  >
                    Cobrar no WhatsApp
                  </Button>
                )}
              </AcoesDaLinha>
            ),
          },
        ]}
        empty={
          <EmptyState
            testId="sem-inadimplencia"
            title={termoDeBusca ? 'Nenhum inadimplente encontrado com esse nome.' : 'Ninguém em atraso'}
            hint={
              termoDeBusca
                ? 'Confira a grafia ou limpe a busca.'
                : 'Nenhuma fatura vencida em aberto neste momento.'
            }
          />
        }
      />
    </>
  );
}

/**
 * A aba "Pagantes" -- espelho de `FilaDeCobranca` para o outro lado da mesma
 * pergunta. UMA LINHA POR ALUNO, nao por fatura: o backend ja dedupe (ver
 * `ConsultarPagosUseCase`), entao cada linha aqui e um aluno em dia, com o
 * pagamento mais recente dele. Mesmas colunas de Aluno/Fatura/Valor da fila
 * de cobranca; Acesso vira badge fixo "Em dia" (nao ha maquina de estado a
 * decidir aqui, so historico), e Acoes perde o botao de cobrar -- ja pagou,
 * nao ha o que cobrar.
 */
function FilaDePagos({
  linhas,
  termoDeBusca,
  prevHref,
  nextHref,
}: {
  linhas: LinhaPaga[];
  termoDeBusca: string;
  prevHref: string;
  nextHref: string;
}) {
  return (
    <>
      <h2 className={estilos['tituloDaFila']}>
        Pagantes
        <span className={estilos['apoioDoTitulo']}>pago mais recentemente primeiro</span>
      </h2>

      <BuscaDeAluno
        prefixo="qPag"
        termoInicial={termoDeBusca}
        label="Buscar aluno pagante"
        testId="busca-pagantes"
      />

      <DataTable
        testId="tabela-de-pagos"
        rows={linhas}
        rowKey={(linha) => linha.studentId}
        rowTestId={(linha) => `pagante-${linha.studentId}`}
        caption="Alunos em dia, com o pagamento mais recente de cada um"
        {...(prevHref ? { prevHref, prevLabel: 'Primeira página' } : {})}
        {...(nextHref ? { nextHref } : {})}
        columns={[
          {
            key: 'aluno',
            header: 'Aluno',
            role: 'identity',
            render: (linha) => (
              <div className={estilos['celulaDoAluno']}>
                <Identidade
                  nome={linha.studentName}
                  secundario={
                    linha.telefone === null ? (
                      <span className={estilos['semTelefone']}>sem telefone cadastrado</span>
                    ) : (
                      /*
                        SEM `mensagem`: aqui nao ha cobranca a lembrar, entao o
                        link abre a conversa vazia -- a recepcao escreve o que
                        precisar (ver docblock de `Telefone`).
                      */
                      <Telefone numero={linha.telefone} />
                    )
                  }
                />
              </div>
            ),
          },
          {
            key: 'fatura',
            header: 'Fatura',
            role: 'code',
            render: (linha) => (
              <div className={estilos['fatura']}>
                <span className={estilos['numero']}>{linha.invoiceNumber}</span>
                <span className={estilos['vencimento']}>
                  pago em{' '}
                  <TenantDateTime iso={linha.paidAt} timeZone={linha.fusoDaUnidade} format="date" />
                </span>
              </div>
            ),
          },
          {
            key: 'acesso',
            header: 'Acesso',
            role: 'state',
            render: () => <StateBadge machine="paidAccess" state="EM_DIA" />,
          },
          {
            key: 'acoes',
            header: 'Ações',
            role: 'actions',
            render: (linha) => (
              <AcoesDaLinha>
                <Button variant="ghost" href={`/students/${linha.studentId}`}>
                  Ver aluno
                </Button>
              </AcoesDaLinha>
            ),
          },
        ]}
        empty={
          <EmptyState
            testId="sem-pagos"
            title={termoDeBusca ? 'Nenhum pagante encontrado com esse nome.' : 'Nenhum pagamento registrado'}
            hint={
              termoDeBusca
                ? 'Confira a grafia ou limpe a busca.'
                : 'Nenhuma fatura paga neste momento.'
            }
          />
        }
      />
    </>
  );
}

/**
 * A mensagem que abre a conversa de cobrança.
 *
 * Vive aqui e não no `Telefone` do DS: o texto é desta tela. "Lembrando da
 * fatura 8222" não serve para a ficha do aluno nem para a avaliação vencida —
 * um texto genérico no componente obrigaria cada tela a contorná-lo.
 */
function mensagemDeCobranca(nomeDoAluno: string, numeroDaFatura: number): string {
  const primeiroNome = nomeDoAluno.trim().split(/\s+/)[0] ?? '';

  return `Ola, ${primeiroNome}! Passando para lembrar da fatura ${String(numeroDaFatura)}, que esta em aberto. Qualquer duvida e so chamar.`;
}
