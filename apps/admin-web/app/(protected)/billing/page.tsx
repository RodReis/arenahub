import type { Metadata } from 'next';
import Link from 'next/link';

import {
  Ausente,
  DataTable,
  EmptyState,
  formatarDinheiro,
  Money,
  PageHeader,
  percentualDoTotal,
  ProblemDetail,
  Sparkline,
} from '@arenahub/ui';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress, ProgressValue } from '@/components/ui/progress';

import { chamarApi } from '../../../lib/api/server-client';
import { AgingDaDivida } from './_graficos/aging-da-divida';
import { ComposicaoPorMetodo } from './_graficos/composicao-por-metodo';
import { EvolucaoDeReceita } from './_graficos/evolucao-de-receita';

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
  planoMaisPopular: { nome: string; quantidade: number } | null;
  ocupacaoPorUnidade: readonly {
    nomeDaUnidade: string;
    alunosAtivos: number;
    capacidadeMaxima: number | null;
  }[];
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
 * `2026-07` vira `2026-08`; `2026-12` vira `2027-01`.
 *
 * Sem `Date`, mesmo motivo de `competenciaLegivel`: competencia e um mes de
 * referencia, nao um instante -- construir um `Date` reintroduz o fuso que o
 * backend ja tirou do caminho.
 */
function mesSeguinte(competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number);
  const anoBase = ano ?? 0;
  const mesBase = mes ?? 1;

  const proximoMes = mesBase === 12 ? 1 : mesBase + 1;
  const proximoAno = mesBase === 12 ? anoBase + 1 : anoBase;

  return `${proximoAno}-${String(proximoMes).padStart(2, '0')}`;
}

function metaMensalMinor(resumo: Resumo): number {
  return resumo.receitaEsperadaMinor;
}

function projecaoFechamentoMinor(resumo: Resumo): number {
  return resumo.recebidoMinor + resumo.aReceberMinor;
}

/** Clampada em 100 -- unidade que passou da capacidade cadastrada mostra barra cheia, nao estourada. */
function capacidadePercentual(alunosAtivos: number, capacidadeMaxima: number): number {
  return Math.min(Math.round((alunosAtivos / capacidadeMaxima) * 100), 100);
}

/**
 * So RECEITA decide o score -- novosAlunos/cancelamentos ficam so como
 * contexto no card. Mesmas 3 guardas do badge de tendencia do Recebido:
 * dado insuficiente, periodo parcial ou meses nao consecutivos viram
 * 'neutro', nunca um veredito que a propria tela contradiz ao lado.
 */
function scoreDoNegocio(variacaoRecebido: number | null): 'saudavel' | 'atencao' | 'neutro' {
  if (variacaoRecebido === null) return 'neutro';
  return variacaoRecebido > 0 ? 'saudavel' : 'atencao';
}

/**
 * Os meses que o filtro oferece, do mais recente para tras.
 *
 * DERIVADOS DA SERIE QUE O BACKEND JA DEVOLVE, e nao de um calendario
 * inventado: oferecer um mes sem movimento levaria o gerente a uma tela vazia
 * que parece defeito. Se a competencia esta na serie, ha o que mostrar nela.
 */
export interface OpcaoDePeriodo {
  readonly rotulo: string;
  readonly de: string;
  readonly ate: string;
  readonly atual: boolean;
  /**
   * O MES EM CURSO VIRA CHIP TAMBEM, mas com `ate = agora` em vez de 1o do
   * mes seguinte -- `validarJanela()` aceita `ate <= agora` (o limite exato
   * "ate agora" e o de uma janela que acabou de fechar por um fio). Sem isto
   * o unico dado de um tenant recem-criado (a fatura do mes corrente) nunca
   * teria chip nenhum ate o mes fechar sozinho.
   *
   * O NUMERO AINDA MUDA: `parcial` avisa a tela para dizer isso, em vez de
   * "periodo fechado" como os demais.
   */
  readonly parcial: boolean;
}

export function periodosDisponiveis(
  competencias: readonly string[],
  janelaAtual: { de: string; ate: string },
  limite = 6,
  agora: Date = new Date(),
): readonly OpcaoDePeriodo[] {
  return [...competencias]
    .sort()
    .reverse()
    .slice(0, limite)
    .reverse()
    .map((competencia) => {
      const [ano, mes] = competencia.split('-').map(Number);
      const de = new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, 1));
      const fimDoMes = new Date(Date.UTC(ano ?? 0, mes ?? 1, 1));
      const parcial = fimDoMes.getTime() > agora.getTime();
      const ate = parcial ? agora : fimDoMes;

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
        parcial,
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

  /*
    A JANELA ABERTA E PARCIAL quando o chip que bate com ela e do mes em
    curso -- "fim exclusivo, período fechado" mentiria ali: o numero ainda
    muda a cada pagamento novo, e `resumo.ate` nao e mais o 1o dia do mes
    seguinte.
  */
  const periodoParcial = periodos.find((periodo) => periodo.atual)?.parcial ?? false;

  /*
    VARIACAO DO RECEBIDO -- a mesma garantia do grafico de serie (achado na
    revisao final: a primeira versao comparava competencia com competencia
    sem essas tres guardas, e "↓ 100%" aparecia toda vez que a competencia
    mais recente ainda estava recebendo pagamento).

    1. `suficienteParaLinha` (>= 3 pontos): mesma regra que libera o proprio
       grafico de tendencia. Com 2 pontos so, a reta entre eles sempre
       parece tendencia (SPEC-054 §5.1) -- e o badge contradiria o aviso
       "dado insuficiente" que a tela mostra ao lado.
    2. Periodo NAO PARCIAL: o mes em curso ainda esta recebendo pagamento, e
       compara-lo com o mes anterior fechado produz uma "queda" que e so o
       mes nao ter terminado.
    3. Competencias CONSECUTIVAS: `montarSerie` no backend so lista meses
       com movimento -- sem fatura nem pagamento, o mes nao aparece. Os dois
       ultimos pontos da serie podem estar a varios meses de distancia, e
       chamar isso de "mes anterior" mentiria.
  */
  const pontosDaSerie = resumo.serie.pontos;
  const penultimoPonto = pontosDaSerie.at(-2);
  const ultimoPonto = pontosDaSerie.at(-1);
  const competenciasConsecutivas =
    penultimoPonto && ultimoPonto
      ? mesSeguinte(penultimoPonto.competencia) === ultimoPonto.competencia
      : false;
  const variacaoRecebido =
    resumo.serie.suficienteParaLinha &&
    !periodoParcial &&
    competenciasConsecutivas &&
    penultimoPonto &&
    ultimoPonto &&
    penultimoPonto.recebidoMinor > 0
      ? Math.round(
          ((ultimoPonto.recebidoMinor - penultimoPonto.recebidoMinor) / penultimoPonto.recebidoMinor) * 1000,
        ) / 10
      : null;

  const scoreDoPeriodo = scoreDoNegocio(variacaoRecebido);
  const ROTULO_DO_SCORE: Readonly<Record<typeof scoreDoPeriodo, string>> = {
    saudavel: 'Saudável',
    atencao: 'Atenção',
    neutro: 'Sem dado suficiente',
  };
  const VARIANTE_DO_SCORE: Readonly<Record<typeof scoreDoPeriodo, 'default' | 'destructive' | 'secondary'>> = {
    saudavel: 'default',
    atencao: 'destructive',
    neutro: 'secondary',
  };

  const progressoDoRecebido = Math.min(
    Math.round((resumo.recebidoMinor / metaMensalMinor(resumo)) * 100),
    100,
  );

  const unidadesComCapacidade = resumo.ocupacaoPorUnidade.filter(
    (unidade) => unidade.capacidadeMaxima !== null,
  );

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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {periodos.length > 0 ? (
          <nav className="flex flex-wrap gap-2" aria-label="Período apurado">
            {periodos.map((periodo) => (
              <a
                key={periodo.rotulo}
                className="rounded-full border border-border px-3 py-1 text-sm text-foreground transition-colors hover:bg-muted aria-[current=page]:border-transparent aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
                href={`/billing?de=${encodeURIComponent(periodo.de)}&ate=${encodeURIComponent(periodo.ate)}`}
                {...(periodo.atual ? { 'aria-current': 'page' as const } : {})}
                data-testid={`periodo-${periodo.rotulo}`}
              >
                {periodo.rotulo}
                {periodo.parcial ? ' (parcial)' : ''}
              </a>
            ))}
          </nav>
        ) : null}

        <p className="text-sm text-muted-foreground" data-testid="periodo-do-resumo">
          <strong className="text-foreground">
            {diaLegivel(resumo.de)} a {diaLegivel(resumo.ate)}
          </strong>{' '}
          · {periodoParcial ? 'mês em andamento, número ainda muda' : 'fim exclusivo, período fechado'}
        </p>
      </div>

      {/*
        HERO KPIS -- os tres indicadores que o gestor abre a tela para ver:
        dinheiro (recebido), alunos (assinaturas vigentes), ticket medio.
        Destacados da faixa compacta que segue, com badge de tendencia so
        quando ha dado real de mes anterior.
      */}
      <section
        className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3"
        aria-label="Indicadores principais do período"
      >
        <Card>
          <CardContent>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Recebido</p>
              {variacaoRecebido !== null ? (
                <Badge
                  data-testid="tendencia-do-recebido-badge"
                  /*
                    ZERO E NEUTRO -- nem sucesso nem risco. `>= 0` sozinho
                    pintaria um "0%" de verde, afirmando melhora que nao houve.
                  */
                  variant={variacaoRecebido > 0 ? 'default' : variacaoRecebido < 0 ? 'destructive' : 'secondary'}
                >
                  {variacaoRecebido > 0 ? '↑' : variacaoRecebido < 0 ? '↓' : '·'}{' '}
                  {String(Math.abs(variacaoRecebido)).replace('.', ',')}% vs mês anterior
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-2xl font-semibold" data-testid="recebido-no-periodo">
              <Money cents={resumo.recebidoMinor} currency="BRL" />
            </p>
            {/*
              TENDENCIA DO RECEBIDO, e so dele. A serie ja vem do backend, entao
              este sparkline sai de graca. "A receber" e "vencido" NAO ganham o
              equivalente: sao fotos do instante, e o banco nao guarda historico
              delas -- fabricar a curva exigiria snapshot mensal, que e fatia
              nova. Decisao do PI em 25/08/2026.
            */}
            <div className="mt-2">
              <Sparkline
                testId="tendencia-do-recebido"
                valores={resumo.serie.pontos.map((ponto) => ponto.recebidoMinor)}
                tokenDeCor="--ah-state-success"
              />
            </div>
            <div className="mt-3">
              <Progress value={progressoDoRecebido} />
              <p className="mt-1 text-xs text-muted-foreground">
                {progressoDoRecebido}% da meta mensal de <Money cents={metaMensalMinor(resumo)} currency="BRL" />
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            {/*
              "ASSINATURAS VIGENTES", nao "alunos ativos" (issue #416): a query
              conta `subscriptions` em `ACTIVE`/`PAST_DUE`, nao a coluna
              `students.status`. Enquanto o rotulo dizia "aluno", este numero
              contradizia a lista de alunos na tela ao lado -- os dois corretos,
              medindo eixos diferentes: contrato vigente aqui, cadastro ativo la.
            */}
            <p className="text-sm text-muted-foreground">Assinaturas vigentes</p>
            <p className="mt-1 text-2xl font-semibold" data-testid="alunos-ativos">
              {resumo.alunosAtivos}
            </p>
            {/* SNAPSHOT DE AGORA, nao do periodo -- "quantos ha", nao "quantos ficaram". */}
            <p className="mt-1 text-xs text-muted-foreground">agora, independente do período</p>

            {resumo.planoMaisPopular !== null ? (
              <p className="mt-3 text-xs text-muted-foreground" data-testid="plano-mais-popular">
                Plano mais popular: <span className="text-foreground">{resumo.planoMaisPopular.nome}</span> (
                {resumo.planoMaisPopular.quantidade})
              </p>
            ) : null}

            {unidadesComCapacidade.length > 0 ? (
              <ul className="mt-3 space-y-2" data-testid="ocupacao-por-unidade">
                {resumo.ocupacaoPorUnidade.map((unidade) => (
                  <li key={unidade.nomeDaUnidade}>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{unidade.nomeDaUnidade}</span>
                      <span>
                        {unidade.alunosAtivos}
                        {unidade.capacidadeMaxima === null ? '' : ` / ${unidade.capacidadeMaxima}`}
                      </span>
                    </div>
                    {unidade.capacidadeMaxima === null ? null : (
                      <Progress
                        value={capacidadePercentual(unidade.alunosAtivos, unidade.capacidadeMaxima)}
                        className="mt-1"
                      >
                        <ProgressValue className="sr-only" />
                      </Progress>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">Ticket médio</p>
            <p className="mt-1 text-2xl font-semibold" data-testid="ticket-medio">
              {resumo.ticketMedioMinor === null ? (
                <Ausente />
              ) : (
                <Money cents={resumo.ticketMedioMinor} currency="BRL" />
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {resumo.pagamentosConfirmados === 0
                ? 'sem pagamento no período'
                : `${resumo.pagamentosConfirmados} pagamento(s) confirmado(s)`}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              projeção de fechamento: <Money cents={projecaoFechamentoMinor(resumo)} currency="BRL" />
            </p>
          </CardContent>
        </Card>
      </section>

      {/*
        FAIXA COMPACTA -- os KPIs restantes, menos os tres promovidos a hero.
        Novos alunos/Cancelamentos/Churn/LTV saem daqui e viram o bloco de
        "Saude do negocio & retencao" mais abaixo, ao lado da divida.
      */}
      <section
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Indicadores do período"
      >
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">Esperado por mês</p>
            <p className="mt-1 text-xl font-semibold" data-testid="receita-esperada">
              <Money cents={resumo.receitaEsperadaMinor} currency="BRL" />
            </p>
            {/*
              DECISAO 3 DO PI: vem do PLANO matriculado, nao da soma das invoices
              emitidas -- no dia 1 do mes, antes do faturamento, a soma das
              invoices seria zero.
            */}
            <p className="mt-1 text-xs text-muted-foreground">
              {resumo.base.alunosPagantes} assinatura(s), pelo plano
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">A receber</p>
            <p className="mt-1 text-xl font-semibold" data-testid="a-receber">
              <Money cents={resumo.aReceberMinor} currency="BRL" />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {resumo.faturasAReceber} fatura(s) vencendo no período
            </p>
          </CardContent>
        </Card>

        <Card size="sm" className={temDivida ? 'ring-(--ah-state-danger)' : undefined}>
          <CardContent>
            <p className="text-sm text-muted-foreground">Vencido</p>
            <p className="mt-1 text-xl font-semibold" data-testid="vencido">
              <Money cents={resumo.vencidoMinor} currency="BRL" />
            </p>
            {/*
              O VENCIDO NAO E RECORTADO PELO PERIODO -- divida de junho continua
              faltando em agosto. A frase esta aqui porque o numero ao lado fala
              do periodo e este fala de agora.
            */}
            <p className="mt-1 text-xs text-muted-foreground">
              {resumo.faturasVencidas} fatura(s), toda a dívida em aberto
            </p>
          </CardContent>
        </Card>

        <Card size="sm" className={temDivida ? 'ring-(--ah-state-risk)' : undefined}>
          <CardContent>
            <p className="text-sm text-muted-foreground">Inadimplência</p>
            <p className="mt-1 text-xl font-semibold" data-testid="taxa-de-inadimplencia">
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
            <p className="mt-1 text-xs text-muted-foreground">
              {resumo.base.alunosInadimplentes} de {resumo.base.alunosPagantes} aluno(s)
            </p>
          </CardContent>
        </Card>

        {/*
          O ESTORNO SO APARECE QUANDO EXISTE. Uma celula fixa "R$ 0,00" em todo
          mes sem devolucao gastaria peso permanente com o caso raro -- e o
          recebido ja e LIQUIDO, entao a ausencia nao esconde nada.
        */}
        {resumo.estornadoMinor > 0 ? (
          <Card size="sm" className="ring-(--ah-state-warning)">
            <CardContent>
              <p className="text-sm text-muted-foreground">Estornado</p>
              <p className="mt-1 text-xl font-semibold" data-testid="estornado">
                <Money cents={resumo.estornadoMinor} currency="BRL" />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">já descontado do recebido</p>
            </CardContent>
          </Card>
        ) : null}
      </section>

      {/*
        LINHA 1 DE GRAFICOS: evolucao de receita (EvolucaoDeReceita, que antes
        era SerieFinanceira numa secao cheia embaixo) lado a lado com a
        composicao de metodo de pagamento (ComposicaoPorMetodo, no lugar de
        GraficoDeRosca).
      */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Faturado e recebido por competência</CardTitle>
            <p className="text-sm text-muted-foreground">
              pelo mês de referência da fatura, não pela data do pagamento
            </p>
          </CardHeader>
          <CardContent>
            {resumo.serie.pontos.length === 0 ? (
              <EmptyState
                testId="sem-competencia"
                title="Nenhuma competência no período"
                hint="Não há faturas emitidas nem pagamentos confirmados para o período apurado."
              />
            ) : (
              <div>
                {/*
                  SERIE CURTA NAO VIRA TENDENCIA (`SPEC-054` §5.1): com um ponto
                  nao ha comparacao, com dois a reta entre eles sempre parece
                  tendencia. O aviso vem ANTES do grafico -- quem le a curva
                  precisa saber que ela e curta antes de concluir dela.
                */}
                {!resumo.serie.suficienteParaLinha ? (
                  <p className="mb-2 text-sm text-muted-foreground" data-testid="serie-insuficiente">
                    Dado insuficiente para comparar períodos:{' '}
                    {resumo.serie.pontos.length === 1
                      ? 'há uma competência apurada'
                      : `há ${resumo.serie.pontos.length} competências apuradas`}
                    , e a comparação de tendência exige pelo menos três.
                  </p>
                ) : null}

                <EvolucaoDeReceita
                  testId="grafico-de-competencia"
                  pontos={resumo.serie.pontos.map((ponto) => ({
                    rotulo: competenciaLegivel(ponto.competencia),
                    faturadoMinor: ponto.faturadoMinor,
                    recebidoMinor: ponto.recebidoMinor,
                  }))}
                />

                {/*
                  A TABELA FICA RECOLHIDA -- `EvolucaoDeReceita` nao publica
                  tabela sr-only para os casos com >= 3 pontos com o mesmo
                  formato desta, entao a regra "todo grafico tem tabela
                  equivalente no DOM" (PRD) fica por conta deste `<details>`.

                  Quem abre a tela quer a TENDENCIA; quem vai conferir um numero
                  abre o detalhe, e e a minoria dos acessos. Aberta por padrao,
                  ela custava ~300px repetindo o que o grafico ja desenha.
                */}
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                    Ver valores exatos
                  </summary>

                  <div className="mt-2">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Por onde o dinheiro entrou</CardTitle>
          </CardHeader>
          <CardContent>
            {resumo.recebidoMinor === 0 ? (
              <EmptyState
                testId="sem-pagamento"
                title="Nenhum pagamento no período"
                hint="Nenhuma forma de pagamento registrou entrada no período apurado."
              />
            ) : (
              /*
                TESTID NO WRAPPER, mesmo motivo do aging ao lado.

                `ComposicaoPorMetodo` OMITE de proposito (e testado assim na
                task 8) o metodo sem movimento -- comportamento correto para o
                GRAFICO, que so desenha fatia com area. Mas a regra desta tela
                (`SPEC-054`) e mais forte: "a quebra mostra as tres formas,
                mesmo zeradas" -- omitir "Cartão" faria PIX+Espécie parecer o
                total e esconderia que uma terceira forma existe e nao entrou.
                A lista de apoio abaixo do grafico cobre exatamente o metodo
                que o grafico deixou de fora.
              */
              <div data-testid="quebra-por-metodo">
                <ComposicaoPorMetodo
                  segmentos={resumo.quebraPorMetodo.map((metodo) => ({
                    rotulo: NOME_DO_METODO[metodo.metodo] ?? metodo.metodo,
                    valorMinor: metodo.minorTotal,
                    percentual: percentualDoTotal(metodo.minorTotal, resumo.recebidoMinor),
                    tokenDeCor: COR_DO_METODO[metodo.metodo] ?? '--ah-text-muted',
                  }))}
                />

                {resumo.quebraPorMetodo.some((metodo) => metodo.minorTotal === 0) ? (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {resumo.quebraPorMetodo
                      .filter((metodo) => metodo.minorTotal === 0)
                      .map((metodo) => (
                        <li key={metodo.metodo}>
                          {NOME_DO_METODO[metodo.metodo] ?? metodo.metodo}: {formatarDinheiro(0)} · 0%
                        </li>
                      ))}
                  </ul>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/*
        LINHA 2 DE GRAFICOS: aging da divida (AgingDaDivida, no lugar de
        BarrasVerticais) lado a lado com o bloco de saude do negocio, que reune
        os quatro KPIs de retencao que saíram da faixa compacta.
      */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Onde o dinheiro parou</CardTitle>
          </CardHeader>
          <CardContent>
            {resumo.faturasVencidas === 0 ? (
              <EmptyState
                testId="sem-divida"
                title="Nenhuma fatura vencida"
                hint="Não há dinheiro parado no momento."
              />
            ) : (
              /*
                O TESTID DA PAGINA VAI NO WRAPPER, NAO REPASSADO AO COMPONENTE:
                `AgingDaDivida` aplica seu `testId` so no wrapper `aria-hidden`
                do grafico visual, deixando a tabela sr-only (onde o valor
                formatado em R$ realmente aparece) de fora do escopo desse
                testid -- comportamento proprio e testado do componente
                (task 8). Aqui o testid precisa cobrir os dois.
              */
              <div data-testid="faixas-da-divida">
                <AgingDaDivida
                  faixas={resumo.faixas.map((faixa) => ({
                    rotulo: faixa.rotulo,
                    valorMinor: faixa.minorTotal,
                    tokenDeCor: COR_DA_FAIXA[faixa.rotulo] ?? '--ah-text-muted',
                  }))}
                />
              </div>
            )}

            <div className="mt-4">
              <Button render={<Link href="/billing/delinquency" />} nativeButton={false}>
                Acessar fila de cobrança
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Saúde do negócio &amp; retenção</CardTitle>
            <Badge variant={VARIANTE_DO_SCORE[scoreDoPeriodo]} data-testid="score-do-negocio">
              {ROTULO_DO_SCORE[scoreDoPeriodo]}
            </Badge>
          </CardHeader>
          <CardContent>
            {/*
              OS QUATRO KPIS DA F74 (`SPEC-074`) que restam: novos, cancelamentos,
              churn e LTV. Alunos ativos ja virou hero card acima.
            */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Novos alunos</p>
                <p className="mt-1 text-lg font-semibold" data-testid="novos-alunos">
                  {resumo.novosAlunos}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">no período</p>
              </div>

              <div className={resumo.cancelamentos > 0 ? 'text-(--ah-state-risk)' : undefined}>
                <p className="text-sm text-muted-foreground">Cancelamentos</p>
                <p className="mt-1 text-lg font-semibold" data-testid="cancelamentos">
                  {resumo.cancelamentos}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">no período</p>
              </div>

              <div className={resumo.cancelamentos > 0 ? 'text-(--ah-state-risk)' : undefined}>
                <p className="text-sm text-muted-foreground">Taxa de churn</p>
                <p className="mt-1 text-lg font-semibold" data-testid="taxa-de-churn">
                  {resumo.taxaDeChurn === null ? (
                    <Ausente />
                  ) : (
                    `${String(resumo.taxaDeChurn).replace('.', ',')}%`
                  )}
                </p>
                {/*
                  LTV E CHURN carregam a mesma ressalva da base do Pacto que a
                  §5.2 da F54 ja aplica a inadimplencia: cancelamento sem evento
                  de timeline nao entra na conta (`SPEC-074` §3).
                */}
                <p className="mt-1 text-xs text-muted-foreground">sobre a base pagante do início do período</p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">LTV</p>
                <p className="mt-1 text-lg font-semibold" data-testid="ltv">
                  {resumo.ltv === null ? <Ausente /> : <Money cents={resumo.ltv} currency="BRL" />}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">ticket médio × vida média observada</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/*
        A BASE SOBRE A QUAL A TELA CALCULA (`SPEC-054` §5.2).

        Os ~295 ativos e os 1.906 importados como `CANCELLED` (ADR-033)
        distorcem qualquer percentual. Uma taxa lida sem o denominador afirma
        sobre a ACADEMIA o que e verdade sobre a IMPORTACAO.
      */}
      <dl className="grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-3" data-testid="base-de-calculo">
        <div>
          <dt className="inline">Base de cálculo:</dt>
          <dd className="inline text-foreground">
            {resumo.base.alunosPagantes} aluno(s) com assinatura ativa ou em atraso
          </dd>
        </div>
        <div>
          <dt className="inline">Com fatura vencida:</dt>
          <dd className="inline text-foreground">{resumo.base.alunosInadimplentes}</dd>
        </div>
        <div>
          <dt className="inline">Assinaturas ativas:</dt>
          <dd className="inline text-foreground">{resumo.base.assinaturasAtivas}</dd>
        </div>
      </dl>
    </section>
  );
}
