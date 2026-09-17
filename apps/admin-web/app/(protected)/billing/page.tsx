import type { Metadata } from 'next';

import {
  Ausente,
  BarrasDeFaixa,
  DataTable,
  EmptyState,
  formatarDinheiro,
  Money,
  PageHeader,
  percentualDoTotal,
  ProblemDetail,
  SerieFinanceira,
  Sparkline,
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
  /**
   * Todas as competencias com movimento, independente da janela apurada.
   *
   * SEPARADO DA SERIE, e o motivo e um bug que o PI viu na tela: o filtro
   * derivava de `serie.pontos`, que olha 12 meses PARA TRAS a partir do fim da
   * janela. Apurar maio devolvia so maio, o filtro ficava com um chip so, e
   * nao havia caminho de volta para junho.
   */
  competenciasDisponiveis: string[];
  base: { alunosPagantes: number; alunosInadimplentes: number; assinaturasAtivas: number };
  /** Os cinco KPIs da F74 (`SPEC-074`) que faltavam para a §64/§117. */
  alunosAtivos: number;
  novosAlunos: number;
  cancelamentos: number;
  taxaDeChurn: number | null;
  ltv: number | null;
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

/**
 * Cor por METODO, e aqui a paleta E categorica de proposito.
 *
 * O contrario do grafico de dividas ao lado, que usa severidade: receber por
 * PIX nao e melhor nem pior que receber por cartao -- sao canais diferentes,
 * nao estados de um mesmo eixo. Pintar um de vermelho afirmaria um risco que
 * nao existe.
 */
const COR_DO_METODO: Readonly<Record<string, string>> = {
  PIX: '--ah-state-success',
  CARD: '--ah-state-info',
  MANUAL: '--ah-state-neutral',
};

/**
 * Nome curto de proposito: o eixo do `BarrasDeFaixa` reserva 104px, e
 * "Espécie ou transferência" quebrava em duas linhas, desalinhando a barra do
 * proprio rotulo. "Espécie" carrega o sentido no balcao -- transferencia
 * reconhecida na recepcao entra pelo mesmo caminho e o gestor a le como
 * dinheiro que chegou fora de provedor.
 */
const NOME_DO_METODO: Readonly<Record<string, string>> = {
  MANUAL: 'Espécie',
  PIX: 'PIX',
  CARD: 'Cartão',
};

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

/**
 * Os meses que o filtro oferece, do mais recente para tras.
 *
 * DERIVADOS DA SERIE QUE O BACKEND JA DEVOLVE, e nao de um calendario
 * inventado: oferecer um mes sem movimento levaria o gerente a uma tela vazia
 * que parece defeito. Se a competencia esta na serie, ha o que mostrar nela.
 *
 * `agora` NAO entra aqui: a funcao e pura, e o mes corrente ja fica de fora
 * porque o backend so devolve competencia anterior ao fim da janela.
 */
export interface OpcaoDePeriodo {
  readonly rotulo: string;
  readonly de: string;
  readonly ate: string;
  readonly atual: boolean;
}

export function periodosDisponiveis(
  competencias: readonly string[],
  janelaAtual: { de: string; ate: string },
  limite = 6,
): readonly OpcaoDePeriodo[] {
  return [...competencias]
    .sort()
    .reverse()
    .slice(0, limite)
    .reverse()
    .map((competencia) => {
      const [ano, mes] = competencia.split('-').map(Number);
      const de = new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, 1));
      const ate = new Date(Date.UTC(ano ?? 0, mes ?? 1, 1));

      return {
        rotulo: competenciaLegivel(competencia),
        de: de.toISOString(),
        ate: ate.toISOString(),
        /*
          Compara so a DATA e nao o instante: a janela default do backend vem
          com hora zerada, mas um `de` digitado na URL pode trazer hora. O mes
          e o mesmo nos dois casos.
        */
        atual:
          de.toISOString().slice(0, 10) === janelaAtual.de.slice(0, 10) &&
          ate.toISOString().slice(0, 10) === janelaAtual.ate.slice(0, 10),
      };
    });
}

/**
 * A JANELA VEM DA URL -- `?de=&ate=`, ISO 8601.
 *
 * URL e nao estado de componente: periodo apurado e a primeira coisa que um
 * gestor manda para o contador ou para o socio, e um painel que so existe na
 * sessao de quem abriu nao pode ser compartilhado nem recarregado.
 *
 * SEM PARAMETRO, o backend aplica o ultimo mes fechado -- por isso os dois sao
 * repassados so quando existem, em vez de a tela inventar um default proprio.
 * Dois lugares decidindo a mesma janela e como elas divergem.
 */
export default async function PainelFinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const { de, ate } = await searchParams;

  const consulta = new URLSearchParams();
  if (de) consulta.set('de', de);
  if (ate) consulta.set('ate', ate);

  const resposta = await chamarApi<Resumo>(
    `/api/v1/billing/summary${consulta.size > 0 ? `?${consulta}` : ''}`,
  );

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

  const periodos = periodosDisponiveis(resumo.competenciasDisponiveis, {
    de: resumo.de,
    ate: resumo.ate,
  });

  /*
    O "não entrou" da competência mais recente é o que dá o tom do KPI de
    vencido: dívida crescendo pinta de risco, estável fica neutra. É o
    indicador que o gerente abre a tela para ver.
  */
  const temDivida = resumo.vencidoMinor > 0;

  return (
    <section aria-labelledby="titulo-financeiro">
      <PageHeader
        id="titulo-financeiro"
        title="Painel financeiro"
        breadcrumb={<span>Receita</span>}
      />

      {/*
        FILTRO ANTES DOS NUMEROS, porque ele os define. Cada chip e uma URL --
        o gerente manda "olha julho" para o contador e o link abre no mesmo
        lugar.
      */}
      <div className={estilos['barraDoPeriodo']}>
        {periodos.length > 0 ? (
          <nav className={estilos['chips']} aria-label="Período apurado">
            {periodos.map((periodo) => (
              <a
                key={periodo.rotulo}
                className={estilos['chip']}
                href={`/billing?de=${encodeURIComponent(periodo.de)}&ate=${encodeURIComponent(periodo.ate)}`}
                {...(periodo.atual ? { 'aria-current': 'page' as const } : {})}
                data-testid={`periodo-${periodo.rotulo}`}
              >
                {periodo.rotulo}
              </a>
            ))}
          </nav>
        ) : null}

        <p className={estilos['periodoApurado']} data-testid="periodo-do-resumo">
          <strong>
            {diaLegivel(resumo.de)} a {diaLegivel(resumo.ate)}
          </strong>{' '}
          · fim exclusivo, período fechado
        </p>
      </div>

      {/*
        FAIXA UNICA DE KPI, no lugar do numero de 3rem mais dois cards soltos.

        Seis indicadores compactos custam menos altura que um gigante, e o
        gerente COMPARA valores lado a lado -- que e o que ele faz -- em vez de
        rolar entre eles. Os que carregam estado tingem a propria superficie
        (ver o CSS); os neutros ficam brancos, e por isso os coloridos saltam.
      */}
      <section className={estilos['faixaDeKpi']} aria-label="Indicadores do período">
        <div className={estilos['kpi']} data-tom="success">
          <p className={estilos['kpiRotulo']}>Recebido</p>
          <p className={estilos['kpiValor']} data-testid="recebido-no-periodo">
            <Money cents={resumo.recebidoMinor} currency="BRL" />
          </p>
          {/*
            TENDENCIA DO RECEBIDO, e so dele. A serie ja vem do backend, entao
            este sparkline sai de graca. "A receber" e "vencido" NAO ganham o
            equivalente: sao fotos do instante, e o banco nao guarda historico
            delas -- fabricar a curva exigiria snapshot mensal, que e fatia
            nova. Decisao do PI em 25/08/2026.
          */}
          <div className={estilos['kpiTendencia']}>
            <Sparkline
              testId="tendencia-do-recebido"
              valores={resumo.serie.pontos.map((ponto) => ponto.recebidoMinor)}
              tokenDeCor="--ah-state-success"
            />
          </div>
        </div>

        <div className={estilos['kpi']}>
          <p className={estilos['kpiRotulo']}>Esperado por mês</p>
          <p className={estilos['kpiValor']} data-testid="receita-esperada">
            <Money cents={resumo.receitaEsperadaMinor} currency="BRL" />
          </p>
          {/*
            DECISAO 3 DO PI: vem do PLANO matriculado, nao da soma das invoices
            emitidas -- no dia 1 do mes, antes do faturamento, a soma das
            invoices seria zero.
          */}
          <p className={estilos['kpiApoio']}>
            {resumo.base.alunosPagantes} assinatura(s), pelo plano
          </p>
        </div>

        <div className={estilos['kpi']}>
          <p className={estilos['kpiRotulo']}>A receber</p>
          <p className={estilos['kpiValor']} data-testid="a-receber">
            <Money cents={resumo.aReceberMinor} currency="BRL" />
          </p>
          <p className={estilos['kpiApoio']}>
            {resumo.faturasAReceber} fatura(s) vencendo no período
          </p>
        </div>

        <div className={estilos['kpi']} {...(temDivida ? { 'data-tom': 'danger' } : {})}>
          <p className={estilos['kpiRotulo']}>Vencido</p>
          <p className={estilos['kpiValor']} data-testid="vencido">
            <Money cents={resumo.vencidoMinor} currency="BRL" />
          </p>
          {/*
            O VENCIDO NAO E RECORTADO PELO PERIODO -- divida de junho continua
            faltando em agosto. A frase esta aqui porque o numero ao lado fala
            do periodo e este fala de agora.
          */}
          <p className={estilos['kpiApoio']}>
            {resumo.faturasVencidas} fatura(s), toda a dívida em aberto
          </p>
        </div>

        <div className={estilos['kpi']} {...(temDivida ? { 'data-tom': 'risk' } : {})}>
          <p className={estilos['kpiRotulo']}>Inadimplência</p>
          <p className={estilos['kpiValor']} data-testid="taxa-de-inadimplencia">
            {/*
              `—` e nao `0%` quando nao ha pagante: academia sem assinatura nao
              tem 0% de inadimplencia, tem uma taxa que nao existe.
            */}
            {resumo.taxaDeInadimplencia === null ? (
              <Ausente />
            ) : (
              `${String(resumo.taxaDeInadimplencia).replace('.', ',')}%`
            )}
          </p>
          <p className={estilos['kpiApoio']}>
            {resumo.base.alunosInadimplentes} de {resumo.base.alunosPagantes} aluno(s)
          </p>
        </div>

        <div className={estilos['kpi']}>
          <p className={estilos['kpiRotulo']}>Ticket médio</p>
          <p className={estilos['kpiValor']} data-testid="ticket-medio">
            {resumo.ticketMedioMinor === null ? (
              <Ausente />
            ) : (
              <Money cents={resumo.ticketMedioMinor} currency="BRL" />
            )}
          </p>
          <p className={estilos['kpiApoio']}>
            {resumo.pagamentosConfirmados === 0
              ? 'sem pagamento no período'
              : `${resumo.pagamentosConfirmados} pagamento(s) confirmado(s)`}
          </p>
        </div>

        {/*
          OS CINCO KPIS DA F74 (`SPEC-074`) -- alunos ativos, novos,
          cancelamentos, churn e LTV. Faltavam para a §64/§117; os seis
          anteriores ja sao da F54.
        */}
        <div className={estilos['kpi']}>
          <p className={estilos['kpiRotulo']}>Alunos ativos</p>
          <p className={estilos['kpiValor']} data-testid="alunos-ativos">
            {resumo.alunosAtivos}
          </p>
          {/* SNAPSHOT DE AGORA, nao do periodo -- "quantos ha", nao "quantos ficaram". */}
          <p className={estilos['kpiApoio']}>agora, independente do período</p>
        </div>

        <div className={estilos['kpi']}>
          <p className={estilos['kpiRotulo']}>Novos alunos</p>
          <p className={estilos['kpiValor']} data-testid="novos-alunos">
            {resumo.novosAlunos}
          </p>
          <p className={estilos['kpiApoio']}>no período</p>
        </div>

        <div className={estilos['kpi']} {...(resumo.cancelamentos > 0 ? { 'data-tom': 'risk' } : {})}>
          <p className={estilos['kpiRotulo']}>Cancelamentos</p>
          <p className={estilos['kpiValor']} data-testid="cancelamentos">
            {resumo.cancelamentos}
          </p>
          <p className={estilos['kpiApoio']}>no período</p>
        </div>

        <div className={estilos['kpi']} {...(resumo.cancelamentos > 0 ? { 'data-tom': 'risk' } : {})}>
          <p className={estilos['kpiRotulo']}>Taxa de churn</p>
          <p className={estilos['kpiValor']} data-testid="taxa-de-churn">
            {resumo.taxaDeChurn === null ? (
              <Ausente />
            ) : (
              `${String(resumo.taxaDeChurn).replace('.', ',')}%`
            )}
          </p>
          <p className={estilos['kpiApoio']}>sobre a base pagante do início do período</p>
        </div>

        <div className={estilos['kpi']}>
          <p className={estilos['kpiRotulo']}>LTV</p>
          <p className={estilos['kpiValor']} data-testid="ltv">
            {resumo.ltv === null ? <Ausente /> : <Money cents={resumo.ltv} currency="BRL" />}
          </p>
          {/*
            LTV E CHURN carregam a mesma ressalva da base do Pacto que a §5.2
            da F54 ja aplica a inadimplencia: cancelamento sem evento de
            timeline nao entra na conta (`SPEC-074` §3).
          */}
          <p className={estilos['kpiApoio']}>ticket médio × vida média observada</p>
        </div>

        {/*
          O ESTORNO SO APARECE QUANDO EXISTE. Uma celula fixa "R$ 0,00" em todo
          mes sem devolucao gastaria peso permanente com o caso raro -- e o
          recebido ja e LIQUIDO, entao a ausencia nao esconde nada.
        */}
        {resumo.estornadoMinor > 0 ? (
          <div className={estilos['kpi']} data-tom="warning">
            <p className={estilos['kpiRotulo']}>Estornado</p>
            <p className={estilos['kpiValor']} data-testid="estornado">
              <Money cents={resumo.estornadoMinor} currency="BRL" />
            </p>
            <p className={estilos['kpiApoio']}>já descontado do recebido</p>
          </div>
        ) : null}
      </section>

      {/*
        DUAS PERGUNTAS IRMAS LADO A LADO: "onde o dinheiro parou" e "por onde
        ele entrou". Empilhadas custavam ~380px e obrigavam a rolar entre duas
        metades da mesma leitura.
      */}
      <div className={estilos['duasColunas']}>
        <div className={estilos['cartao']}>
          <h2 className={estilos['tituloDoCartao']}>Onde o dinheiro parou</h2>
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
                valorLegivel: formatarDinheiro(faixa.minorTotal),
              }))}
            />
          )}
        </div>

        <div className={estilos['cartao']}>
          <h2 className={estilos['tituloDoCartao']}>Por onde o dinheiro entrou</h2>
          {/*
            BARRAS E NAO TABELA: a pergunta aqui e de PROPORCAO -- "o PIX e
            quanto do meu caixa?" --, e proporcao se le comparando comprimentos,
            nao alinhando tres numeros em coluna.
          */}
          {resumo.recebidoMinor === 0 ? (
            <EmptyState
              testId="sem-pagamento"
              title="Nenhum pagamento no período"
              hint="Nenhuma forma de pagamento registrou entrada no período apurado."
            />
          ) : (
            <BarrasDeFaixa
              testId="quebra-por-metodo"
              descricao="Valor recebido por forma de pagamento no período apurado"
              faixas={resumo.quebraPorMetodo.map((metodo) => {
                const proporcao = percentualDoTotal(metodo.minorTotal, resumo.recebidoMinor);

                return {
                  rotulo: NOME_DO_METODO[metodo.metodo] ?? metodo.metodo,
                  valor: metodo.minorTotal,
                  tokenDeCor: COR_DO_METODO[metodo.metodo] ?? '--ah-text-muted',
                  /*
                    VALOR E PROPORCAO, sem a contagem: tres informacoes na ponta
                    da barra estouravam a largura e quebravam em duas linhas. A
                    contagem de pagamentos nao responde a pergunta do bloco.
                  */
                  valorLegivel:
                    proporcao === null
                      ? formatarDinheiro(metodo.minorTotal)
                      : `${formatarDinheiro(metodo.minorTotal)} · ${String(proporcao).replace('.', ',')}%`,
                };
              })}
            />
          )}
        </div>
      </div>

      <section className={estilos['secao']} aria-labelledby="titulo-competencia">
        <h2 id="titulo-competencia" className={estilos['tituloDaSecao']}>
          Faturado e recebido por competência
          <span className={estilos['apoioDoTitulo']}>
            pelo mês de referência da fatura, não pela data do pagamento
          </span>
        </h2>

        {resumo.serie.pontos.length === 0 ? (
          <EmptyState
            testId="sem-competencia"
            title="Nenhuma competência no período"
            hint="Não há faturas emitidas nem pagamentos confirmados para o período apurado."
          />
        ) : (
          <div className={estilos['grafico']}>
            {/*
              SERIE CURTA NAO VIRA TENDENCIA (`SPEC-054` §5.1): com um ponto
              nao ha comparacao, com dois a reta entre eles sempre parece
              tendencia. O aviso vem ANTES do grafico -- quem le a curva
              precisa saber que ela e curta antes de concluir dela.
            */}
            {!resumo.serie.suficienteParaLinha ? (
              <p className={estilos['avisoDaSerie']} data-testid="serie-insuficiente">
                Dado insuficiente para comparar períodos:{' '}
                {resumo.serie.pontos.length === 1
                  ? 'há uma competência apurada'
                  : `há ${resumo.serie.pontos.length} competências apuradas`}
                , e a comparação de tendência exige pelo menos três.
              </p>
            ) : null}

            <SerieFinanceira
              testId="grafico-de-competencia"
              descricao="Valor faturado e recebido por mês de competência"
              pontos={resumo.serie.pontos.map((ponto) => ({
                rotulo: competenciaLegivel(ponto.competencia),
                faturadoMinor: ponto.faturadoMinor,
                recebidoMinor: ponto.recebidoMinor,
              }))}
            />

            {/*
              A TABELA FICA RECOLHIDA, e o `SerieFinanceira` ja publica uma
              tabela INVISIVEL para leitor de tela -- entao a regra "todo
              grafico tem tabela equivalente no DOM" (PRD) esta cumprida com o
              `<details>` fechado.

              Quem abre a tela quer a TENDENCIA; quem vai conferir um numero
              abre o detalhe, e e a minoria dos acessos. Aberta por padrao, ela
              custava ~300px repetindo o que o grafico ja desenha.
            */}
            <details className={estilos['detalhe']}>
              <summary className={estilos['detalheGatilho']}>Ver valores exatos</summary>

              <div className={estilos['detalheConteudo']}>
                <DataTable
                  testId="serie-por-competencia"
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
                    {
                      /*
                        A COLUNA QUE A TABELA ANTIGA NAO TINHA. O gestor vinha
                        subtraindo faturado menos recebido a cada linha para
                        achar o buraco do mes -- que e a pergunta do bloco.
                      */
                      key: 'naoEntrou',
                      header: 'Não entrou',
                      role: 'value',
                      render: (ponto) => (
                        <Money
                          cents={Math.max(ponto.faturadoMinor - ponto.recebidoMinor, 0)}
                          currency="BRL"
                        />
                      ),
                    },
                  ]}
                />
              </div>
            </details>
          </div>
        )}
      </section>

      {/*
        A BASE SOBRE A QUAL A TELA CALCULA (`SPEC-054` §5.2).

        Os ~295 ativos e os 1.906 importados como `CANCELLED` (ADR-033)
        distorcem qualquer percentual. Uma taxa lida sem o denominador afirma
        sobre a ACADEMIA o que e verdade sobre a IMPORTACAO.
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
