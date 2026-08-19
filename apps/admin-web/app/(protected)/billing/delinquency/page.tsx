import type { Metadata } from 'next';

import {
  BarrasDeFaixa,
  Button,
  DataTable,
  EmptyState,
  AcoesDaLinha,
  Identidade,
  Money,
  PageHeader,
  ProblemDetail,
  StateBadge,
  TenantDateTime,
} from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import {
  linkDeCobranca,
  motivosDaLinha,
  situacaoVisivel,
  telefoneLegivel,
} from '../../../../src/billing/inadimplencia';
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
    bloqueados: number;
    taxaDeInadimplencia: number | null;
  };
  faixas: { rotulo: string; minorTotal: number; quantidade: number }[];
  linhas: Linha[];
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

/** Formata centavos para o rotulo do grafico, que recebe texto pronto. */
function reais(minor: number): string {
  return `R$ ${(minor / 100).toFixed(2).replace('.', ',')}`;
}

export default async function InadimplenciaPage() {
  const resposta = await chamarApi<Painel>('/api/v1/billing/delinquency');

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-inadimplencia">
        <PageHeader id="titulo-inadimplencia" title="Inadimplência e cobrança" />
        <ProblemDetail
          testId="erro-de-inadimplencia"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para consultar a cobrança (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const { resumo, faixas, linhas } = resposta.dados;

  return (
    <section aria-labelledby="titulo-inadimplencia">
      <PageHeader
        id="titulo-inadimplencia"
        title="Inadimplência e cobrança"
        breadcrumb={<span>Receita</span>}
      />

      {/*
        BLOCO 1 -- O GESTOR.

        Duas colunas: o dinheiro a esquerda, a composicao dele a direita. O
        valor total e a RESPOSTA da tela, entao ele nao divide peso com os
        outros numeros -- os tres cards iguais da versao anterior obrigavam a
        pessoa a ler os tres para descobrir qual importava.
      */}
      <section className={estilos['visaoDoGestor']} aria-label="Visão geral da inadimplência">
        <div className={estilos['dinheiro']}>
          <p className={estilos['rotulo']}>Em atraso agora</p>
          <p className={estilos['valorGigante']}>
            <Money cents={resumo.emAtrasoMinor} currency="BRL" />
          </p>

          <dl className={estilos['secundarios']}>
            <div>
              <dt>Faturas</dt>
              <dd>{resumo.faturasVencidas}</dd>
            </div>
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
          <h2 className={estilos['tituloDoBloco']}>Onde está o dinheiro parado</h2>
          {/*
            NAO E EVOLUCAO MENSAL, e a escolha e deliberada: o sistema tem UM
            mes de dado. Uma linha temporal com um ponto so nao informa nada, e
            desenha-la com meses vazios antes faria a curva subir do zero,
            sugerindo uma piora que nao aconteceu.

            A composicao responde hoje o que o gestor pergunta: quanto da
            divida ja e velha demais para voltar.
          */}
          <BarrasDeFaixa
            testId="faixas-de-atraso"
            descricao="Valor em atraso por faixa de tempo"
            faixas={faixas.map((faixa) => ({
              rotulo: faixa.rotulo,
              valor: faixa.minorTotal,
              tokenDeCor: COR_DA_FAIXA[faixa.rotulo] ?? '--ah-text-muted',
              valorLegivel: reais(faixa.minorTotal),
            }))}
          />
        </div>
      </section>

      {/*
        BLOCO 2 -- A RECEPCAO.

        Ordenada por URGENCIA (valor x dias), nao por data: quem trabalha esta
        fila tem meia hora entre um aluno e outro e precisa saber por onde
        COMECAR, nao quem venceu primeiro.
      */}
      <h2 className={estilos['tituloDaFila']}>
        Fila de cobrança
        <span className={estilos['apoioDoTitulo']}>maior valor parado há mais tempo primeiro</span>
      </h2>

      <DataTable
        testId="tabela-de-inadimplencia"
        rows={linhas}
        rowKey={(linha) => linha.invoiceId}
        rowTestId={(linha) => `fatura-${linha.invoiceId}`}
        caption="Faturas vencidas em aberto, da mais urgente para a menos urgente"
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
                    linha.telefone === null ||
                    linkDeCobranca(linha.telefone, linha.studentName, linha.invoiceNumber) === null ? (
                      <span className={estilos['semTelefone']}>sem telefone cadastrado</span>
                    ) : (
                      telefoneLegivel(linha.telefone)
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
            key: 'valor',
            header: 'Valor',
            role: 'value',
            /*
              O VALOR ORDENA A FILA, entao carrega o maior peso tipografico da
              linha. Na versao anterior tinha o mesmo tamanho do numero da
              fatura, que ninguem precisa comparar entre linhas.
            */
            render: (linha) => (
              <span className={estilos['valor']}>
                <Money cents={linha.amountMinor} currency={linha.currency} />
              </span>
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
            title="Ninguém em atraso"
            hint="Nenhuma fatura vencida em aberto neste momento."
          />
        }
      />
    </section>
  );
}
