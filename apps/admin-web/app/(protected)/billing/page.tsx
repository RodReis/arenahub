import type { Metadata } from 'next';

import {
  Ausente,
  BarrasDeFaixa,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  ProblemDetail,
} from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import estilos from './summary.module.css';

export const metadata: Metadata = {
  title: 'Painel financeiro — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Faixa {
  rotulo: string;
  minorTotal: number;
  quantidade: number;
}

interface Metodo {
  metodo: string;
  minorTotal: number;
  quantidade: number;
}

interface Ponto {
  competencia: string;
  faturadoMinor: number;
  recebidoMinor: number;
}

interface Resumo {
  de: string;
  ate: string;
  recebidoMinor: number;
  pagamentosConfirmados: number;
  estornadoMinor: number;
  receitaEsperadaMinor: number;
  aReceberMinor: number;
  faturasAReceber: number;
  vencidoMinor: number;
  faturasVencidas: number;
  faixas: Faixa[];
  ticketMedioMinor: number | null;
  taxaDeInadimplencia: number | null;
  quebraPorMetodo: Metodo[];
  serie: { pontos: Ponto[]; suficienteParaLinha: boolean };
  base: { alunosPagantes: number; alunosInadimplentes: number; assinaturasAtivas: number };
}

/**
 * Cor por SEVERIDADE, nao por variedade -- mesmo criterio da tela de
 * inadimplencia, e de proposito: duas telas do mesmo financeiro que pintassem
 * "mais de 30 dias" de cores diferentes fariam o gestor duvidar de qual esta
 * certa.
 *
 * TOKENS DE ESTADO, nao de accent: `--ah-accent-*` acompanha o seed do tenant
 * (regra 2 do DS §11), e a paleta do grafico sairia errada na academia que tem
 * outra cor de marca.
 */
const COR_DA_FAIXA: Readonly<Record<string, string>> = {
  'Até 15 dias': '--ah-state-warning',
  '16 a 30 dias': '--ah-state-risk',
  '31 a 60 dias': '--ah-state-danger',
  'Mais de 60 dias': '--ah-state-danger',
};

const NOME_DO_METODO: Readonly<Record<string, string>> = {
  MANUAL: 'Espécie ou transferência',
  PIX: 'PIX',
  CARD: 'Cartão',
};

/** Rotulo do grafico, que recebe texto pronto. */
function reais(minor: number): string {
  return `R$ ${(minor / 100).toFixed(2).replace('.', ',')}`;
}

/**
 * `2026-08` vira `ago/2026`.
 *
 * Sem `Intl` e sem `Date`: a competencia e um mes de referencia, nao um
 * instante -- construir um `Date` a partir dela reintroduz o fuso que o
 * backend ja tirou do caminho, e foi assim que a F53 mostrou o dia anterior.
 */
const MESES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

function competenciaLegivel(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  const indice = Number(mes) - 1;

  return `${MESES[indice] ?? mes}/${ano}`;
}

/** `2026-08-01T00:00:00.000Z` vira `01/08/2026`, sem passar por `Date`. */
function diaLegivel(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');

  return `${dia}/${mes}/${ano}`;
}

export default async function PainelFinanceiroPage() {
  const resposta = await chamarApi<Resumo>('/api/v1/billing/summary');

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-financeiro">
        <PageHeader id="titulo-financeiro" title="Painel financeiro" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível carregar o painel financeiro (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const resumo = resposta.dados;

  return (
    <section aria-labelledby="titulo-financeiro">
      <PageHeader
        id="titulo-financeiro"
        title="Painel financeiro"
        breadcrumb={<span>Receita</span>}
      />

      {/*
        A JANELA, VISIVEL. O backend recusa periodo em curso e cai no ultimo
        mes fechado -- sem dizer qual, o gestor leria os numeros como "agora".
      */}
      <p className={estilos['periodo']} data-testid="periodo-do-resumo">
        Período apurado:{' '}
        <span className={estilos['periodoValor']}>
          {diaLegivel(resumo.de)} a {diaLegivel(resumo.ate)}
        </span>
        <span>(fim exclusivo — o período está fechado)</span>
      </p>

      {/*
        BLOCO 1 -- a resposta da tela.

        O recebido a esquerda, sozinho e grande; a composicao da divida a
        direita. Os numeros de apoio nao viram cards: dar a eles o mesmo peso
        obrigaria a ler os quatro para descobrir qual importa.
      */}
      <section className={estilos['visaoDoDono']} aria-label="Visão geral do período">
        <div className={estilos['dinheiro']}>
          <p className={estilos['rotulo']}>
            {resumo.estornadoMinor > 0 ? 'Recebido no período (líquido)' : 'Recebido no período'}
          </p>
          <p className={estilos['valorGigante']} data-testid="recebido-no-periodo">
            <Money cents={resumo.recebidoMinor} currency="BRL" />
          </p>

          <dl className={estilos['secundarios']}>
            <div>
              <dt>A receber</dt>
              <dd data-testid="a-receber">
                <Money cents={resumo.aReceberMinor} currency="BRL" />
              </dd>
            </div>
            <div>
              <dt>Vencido</dt>
              <dd data-testid="vencido">
                <Money cents={resumo.vencidoMinor} currency="BRL" />
              </dd>
            </div>
            {/*
              O ESTORNO SO APARECE QUANDO EXISTE.
              
              Uma linha fixa "Estornado R$ 0,00" em todo mes sem devolucao
              gastaria peso permanente com o caso raro -- e o recebido ja e
              LIQUIDO, entao a ausencia da linha nao esconde nada. Quando ha
              devolucao, ela precisa estar visivel: o dono nao pode descobrir
              que R$ 900 sairam so conferindo o extrato.
            */}
            {resumo.estornadoMinor > 0 ? (
              <div>
                <dt>Estornado</dt>
                <dd data-testid="estornado">
                  <Money cents={resumo.estornadoMinor} currency="BRL" />
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Inadimplência</dt>
              <dd data-testid="taxa-de-inadimplencia">
                {/*
                  `—` e nao `0%` quando nao ha pagante: academia sem assinatura
                  nao tem 0% de inadimplencia, tem uma taxa que nao existe.
                */}
                {resumo.taxaDeInadimplencia === null ? (
                  <Ausente />
                ) : (
                  `${String(resumo.taxaDeInadimplencia).replace('.', ',')}%`
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className={estilos['composicao']}>
          <h2 className={estilos['tituloDoBloco']}>Onde está o dinheiro parado</h2>
          {/*
            O VENCIDO NAO E RECORTADO PELO PERIODO -- divida de junho continua
            faltando em agosto. E por isso que este bloco fala de "agora" e o
            numero grande fala do periodo: sao perguntas diferentes.
          */}
          {resumo.faturasVencidas === 0 ? (
            <EmptyState
              testId="sem-divida"
              title="Nenhuma fatura vencida"
              hint="Não há dinheiro parado no momento."
            />
          ) : (
            <BarrasDeFaixa
              testId="faixas-da-divida"
              descricao="Valor vencido por faixa de tempo, considerando toda a dívida em aberto"
              faixas={resumo.faixas.map((faixa) => ({
                rotulo: faixa.rotulo,
                valor: faixa.minorTotal,
                tokenDeCor: COR_DA_FAIXA[faixa.rotulo] ?? '--ah-text-muted',
                valorLegivel: reais(faixa.minorTotal),
              }))}
            />
          )}
        </div>
      </section>

      <section className={estilos['faixaSecundaria']} aria-label="Expectativa e ticket médio">
        <div className={estilos['cartao']}>
          <p className={estilos['rotulo']}>Receita esperada por mês</p>
          <p className={estilos['valorMedio']} data-testid="receita-esperada">
            <Money cents={resumo.receitaEsperadaMinor} currency="BRL" />
          </p>
          {/*
            DECISAO 3 DO PI: vem do PLANO matriculado, nao da soma das invoices
            emitidas. A frase esta na tela porque a diferenca e visivel -- no
            dia 1 do mes, antes do faturamento, a soma das invoices seria zero.
          */}
          <p className={estilos['apoio']}>
            Soma do preço vigente dos planos das {resumo.base.alunosPagantes} assinaturas que
            deveriam estar pagando — não das faturas já emitidas.
          </p>
        </div>

        <div className={estilos['cartao']}>
          <p className={estilos['rotulo']}>Ticket médio</p>
          <p className={estilos['valorMedio']} data-testid="ticket-medio">
            {resumo.ticketMedioMinor === null ? (
              <Ausente />
            ) : (
              <Money cents={resumo.ticketMedioMinor} currency="BRL" />
            )}
          </p>
          <p className={estilos['apoio']}>
            {resumo.pagamentosConfirmados === 0
              ? 'Nenhum pagamento confirmado no período — não há do que tirar média.'
              : `Média de ${resumo.pagamentosConfirmados} pagamento(s) confirmado(s) no período.`}
          </p>
        </div>
      </section>

      <section className={estilos['secao']} aria-labelledby="titulo-metodos">
        <h2 id="titulo-metodos" className={estilos['tituloDaSecao']}>
          Como o dinheiro entrou
          <span className={estilos['apoioDoTitulo']}>no período apurado</span>
        </h2>

        <DataTable
          testId="quebra-por-metodo"
          /*
            NUNCA VAZIA: as tres formas vem sempre do backend, zeradas quando
            nao houve movimento -- e o que faz a quebra somar 100% em vez de
            sumir uma fatia. O `empty` existe porque o tipo exige.
          */
          empty={<EmptyState title="Nenhum pagamento no período" />}
          rows={resumo.quebraPorMetodo}
          rowKey={(linha) => linha.metodo}
          caption="Valor recebido por forma de pagamento"
          columns={[
            {
              key: 'metodo',
              header: 'Forma',
              role: 'identity',
              render: (linha) => NOME_DO_METODO[linha.metodo] ?? linha.metodo,
            },
            {
              key: 'quantidade',
              header: 'Pagamentos',
              role: 'value',
              render: (linha) => linha.quantidade,
            },
            {
              key: 'valor',
              header: 'Valor',
              role: 'value',
              render: (linha) => <Money cents={linha.minorTotal} currency="BRL" />,
            },
          ]}
        />
      </section>

      <section className={estilos['secao']} aria-labelledby="titulo-competencia">
        <h2 id="titulo-competencia" className={estilos['tituloDaSecao']}>
          Faturado e recebido por competência
          <span className={estilos['apoioDoTitulo']}>
            pelo mês de referência da fatura, não pela data do pagamento
          </span>
        </h2>

        {/*
          SERIE CURTA NAO VIRA GRAFICO (`SPEC-054` §5.1).

          Com um ponto nao ha comparacao; com dois, a reta entre eles sempre
          parece tendencia. O backend decide (`suficienteParaLinha`) e a tela
          diz o que falta, em vez de desenhar uma curva que o dado nao sustenta
          -- o `STATUS.md` de 19/08 ja registrou o caso na F15.

          A TABELA APARECE NOS DOIS CASOS: o dado existe e e legivel; o que a
          serie curta nao autoriza e a leitura de TENDENCIA, nao a consulta.
        */}
        {resumo.serie.pontos.length === 0 ? (
          <EmptyState
            testId="sem-competencia"
            title="Nenhuma competência no período"
            hint="Não há faturas emitidas nem pagamentos confirmados para o período apurado."
          />
        ) : (
          <>
            {!resumo.serie.suficienteParaLinha ? (
              <p className={estilos['apoio']} data-testid="serie-insuficiente">
                Dado insuficiente para comparar períodos: há{' '}
                {resumo.serie.pontos.length === 1
                  ? 'uma competência'
                  : `${resumo.serie.pontos.length} competências`}{' '}
                apurada(s), e a comparação de tendência exige pelo menos três.
              </p>
            ) : null}

            <DataTable
              testId="serie-por-competencia"
              // O caso vazio e tratado acima, antes de chegar aqui.
              empty={<EmptyState title="Nenhuma competência no período" />}
              rows={resumo.serie.pontos}
              rowKey={(ponto) => ponto.competencia}
              caption="Valor faturado e recebido por mês de competência"
              columns={[
                {
                  key: 'competencia',
                  header: 'Competência',
                  role: 'identity',
                  render: (ponto) => competenciaLegivel(ponto.competencia),
                },
                {
                  key: 'faturado',
                  header: 'Faturado',
                  role: 'value',
                  render: (ponto) => <Money cents={ponto.faturadoMinor} currency="BRL" />,
                },
                {
                  key: 'recebido',
                  header: 'Recebido',
                  role: 'value',
                  render: (ponto) => <Money cents={ponto.recebidoMinor} currency="BRL" />,
                },
              ]}
            />
          </>
        )}
      </section>

      {/*
        A BASE SOBRE A QUAL A TELA CALCULA (`SPEC-054` §5.2).

        Os ~340 alunos ativados da base do Pacto e os 1.926 importados como
        `CANCELLED` (ADR-033) distorcem qualquer percentual. Uma taxa lida sem
        o denominador afirma sobre a ACADEMIA o que e verdade sobre a
        IMPORTACAO.
      */}
      <dl className={estilos['base']} data-testid="base-de-calculo">
        <div>
          <dt>Base de cálculo:</dt>
          <dd>{resumo.base.alunosPagantes} aluno(s) com assinatura ativa ou em atraso</dd>
        </div>
        <div>
          <dt>Com fatura vencida:</dt>
          <dd>{resumo.base.alunosInadimplentes}</dd>
        </div>
        <div>
          <dt>Assinaturas ativas:</dt>
          <dd>{resumo.base.assinaturasAtivas}</dd>
        </div>
      </dl>
    </section>
  );
}
