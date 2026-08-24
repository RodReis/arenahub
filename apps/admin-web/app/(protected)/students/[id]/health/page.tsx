import type { Metadata } from 'next';

import {
  Ausente,
  EmptyState,
  PageHeader,
  ProblemDetail,
  SerieDeMedidas,
  TenantDateTime,
} from '@arenahub/ui';

import { chamarApi } from '../../../../../lib/api/server-client';
import {
  MOTIVO_DE_AUSENCIA,
  percentualLegivel,
  rotuloDeTipo,
  rotuloDoEixo,
  valorLegivel,
  variacaoLegivel,
} from '../../../../../src/health/formatar';
import { EnvioDeLaudos } from './envio-de-laudos';
import { FiltroDePeriodo } from './filtro-de-periodo';
import { AvaliacaoCompleta } from './imports/[sessionId]/avaliacao-completa';
import { SeletorDeMedicao, type MedicaoDisponivel } from './seletor-de-medicao';

export const metadata: Metadata = {
  title: 'Evolução corporal — ArenaHub',
};

export const dynamic = 'force-dynamic';

/** Os cinco períodos do `M3-FR-008`. */
const PERIODOS = ['30D', '90D', '6M', '1Y', 'ALL'] as const;

type Periodo = (typeof PERIODOS)[number];

const ROTULO_DE_PERIODO: Record<Periodo, string> = {
  '30D': '30 dias',
  '90D': '90 dias',
  '6M': '6 meses',
  '1Y': '1 ano',
  ALL: 'Tudo',
};

interface Variacao {
  absolute: number | null;
  percent: number | null;
  fromAssessmentId: string | null;
  toAssessmentId: string | null;
  absentReason: string | null;
}

interface Ponto {
  assessmentId: string;
  assessedAt: string;
  /** Data local (`AAAA-MM-DD`) já no fuso da unidade — vem pronta do servidor. */
  assessedAtLocal: string;
  value: number;
}

interface Comparativo {
  type: string;
  unit: string | null;
  points: Ponto[];
  first: Ponto | null;
  previous: Ponto | null;
  current: Ponto | null;
  sinceFirst: Variacao;
  sincePrevious: Variacao;
  toGoal: Variacao;
  goal: { id: string; target: number; deadline: string } | null;
}

interface Historico {
  studentId: string;
  period: string;
  timezone: string;
  measurements: Comparativo[];
}

interface Aluno {
  fullName: string;
}

function ehPeriodo(valor: string | undefined): valor is Periodo {
  return valor !== undefined && (PERIODOS as readonly string[]).includes(valor);
}

/**
 * Uma célula de comparação.
 *
 * Quando não há número, escreve o MOTIVO em vez de um traço mudo: "sem
 * medição anterior" e "meta não definida" pedem ações diferentes de quem lê,
 * e um traço para os dois casos esconderia essa diferença.
 */
function Comparacao({
  titulo,
  variacao,
  unidade,
  testId,
}: {
  titulo: string;
  variacao: Variacao;
  unidade: string | null;
  testId: string;
}) {
  if (variacao.absolute === null) {
    return (
      <div>
        <dt>{titulo}</dt>
        <dd data-testid={testId}>
          {/*
            `Ausente` é o traço com `aria-label` — sozinho ele diz "não
            informado", mas não POR QUE. O motivo vem ao lado, em texto, porque
            "sem medição anterior" e "meta não definida" pedem ações diferentes
            de quem lê a tela.
          */}
          <Ausente />{' '}
          <span>{MOTIVO_DE_AUSENCIA[variacao.absentReason ?? ''] ?? 'sem dados'}</span>
        </dd>
      </div>
    );
  }

  return (
    <div>
      <dt>{titulo}</dt>
      <dd data-testid={testId}>
        {variacaoLegivel(variacao.absolute, unidade)}
        {/*
          O percentual é ausente quando o baseline era zero — a diferença
          absoluta continua verdadeira, mas a divisão não existe.
        */}
        {variacao.percent !== null ? ` (${percentualLegivel(variacao.percent)})` : null}
      </dd>
    </div>
  );
}

/** Um tipo medido: gráfico, comparações e a tabela de medições. */
function BlocoDoTipo({ comparativo, fuso }: { comparativo: Comparativo; fuso: string }) {
  const titulo = rotuloDeTipo(comparativo.type);
  const idDoTitulo = `titulo-${comparativo.type.toLowerCase()}`;

  return (
    <section aria-labelledby={idDoTitulo} data-testid={`bloco-${comparativo.type}`}>
      <h2 id={idDoTitulo}>{titulo}</h2>

      <SerieDeMedidas
        testId={`grafico-${comparativo.type}`}
        descricao={`${titulo} por data de medição`}
        pontos={comparativo.points.map((ponto) => ({
          rotulo: rotuloDoEixo(ponto.assessedAtLocal),
          valor: ponto.value,
          valorLegivel: valorLegivel(ponto.value, comparativo.unit),
        }))}
        meta={
          comparativo.goal !== null
            ? {
                valor: comparativo.goal.target,
                rotulo: valorLegivel(comparativo.goal.target, comparativo.unit),
              }
            : undefined
        }
      />

      <dl>
        <div>
          <dt>Atual</dt>
          <dd data-testid={`atual-${comparativo.type}`}>
            {comparativo.current === null ? (
              <>
                <Ausente /> <span>nenhuma medição publicada neste período</span>
              </>
            ) : (
              <>
                {valorLegivel(comparativo.current.value, comparativo.unit)}
                {' em '}
                <TenantDateTime iso={comparativo.current.assessedAt} timeZone={fuso} format="date" />
              </>
            )}
          </dd>
        </div>
        <Comparacao
          titulo="Desde a anterior"
          variacao={comparativo.sincePrevious}
          unidade={comparativo.unit}
          testId={`anterior-${comparativo.type}`}
        />
        <Comparacao
          titulo="Desde a primeira"
          variacao={comparativo.sinceFirst}
          unidade={comparativo.unit}
          testId={`primeira-${comparativo.type}`}
        />
        <Comparacao
          titulo="Até a meta"
          variacao={comparativo.toGoal}
          unidade={comparativo.unit}
          testId={`meta-${comparativo.type}`}
        />
      </dl>

      {/*
        A tabela repete o que o gráfico mostra, VISÍVEL para todos — não é a
        tabela invisível do leitor de tela (essa vive dentro do componente).
        Quem precisa do número exato não deveria ter de mirar num ponto.
      */}
      {comparativo.points.length > 0 ? (
        <table data-testid={`tabela-${comparativo.type}`}>
          <caption>Medições de {titulo.toLowerCase()} no período</caption>
          <thead>
            <tr>
              <th scope="col">Data da medição</th>
              <th scope="col">Valor</th>
            </tr>
          </thead>
          <tbody>
            {comparativo.points.map((ponto) => (
              <tr key={ponto.assessmentId}>
                <td>
                  <TenantDateTime iso={ponto.assessedAt} timeZone={fuso} format="date" />
                </td>
                <td>{valorLegivel(ponto.value, comparativo.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

export default async function PaginaDaEvolucao({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string; medicao?: string }>;
}) {
  const { id } = await params;
  const { period, medicao } = await searchParams;

  // Período inválido na URL cai no padrão da tela em vez de estourar: a query
  // é editável pelo usuário, e um 400 aqui seria uma página de erro por uma
  // letra digitada errada. A API continua recusando `60D` — esta é a camada
  // de apresentação escolhendo um padrão, não o servidor aceitando lixo.
  const periodo: Periodo = ehPeriodo(period) ? period : '90D';

  const [respostaDoAluno, respostaDoHistorico, respostaDasMedicoes] = await Promise.all([
    chamarApi<Aluno>(`/api/v1/students/${id}`),
    chamarApi<Historico>(`/api/v1/students/${id}/health-progress?period=${periodo}`),
    // As medições disponíveis, para o seletor e para saber qual mostrar.
    // Falha aqui NÃO derruba a tela: sem a lista, a página cai no que era
    // antes (envio + gráficos), que continua útil.
    chamarApi<MedicaoDisponivel[]>(`/api/v1/students/${id}/assessment-sessions`),
  ]);

  if (!respostaDoAluno.ok || !respostaDoAluno.dados) {
    const codigo = respostaDoAluno.erro?.code ?? 'erro';

    return (
      <section aria-labelledby="titulo-evolucao">
        <PageHeader id="titulo-evolucao" title="Evolução corporal" />
        <ProblemDetail
          testId={codigo === 'STUDENT_NOT_FOUND' ? 'aluno-nao-encontrado' : 'erro-da-evolucao'}
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
                : `Não foi possível abrir a evolução corporal (${codigo}).`,
          }}
        />
        <p>
          <a href="/students">Voltar para a lista de alunos</a>
        </p>
      </section>
    );
  }

  const aluno = respostaDoAluno.dados;

  // FALHA NÃO É HISTÓRICO VAZIO.
  //
  // Com `?? { measurements: [] }`, uma consulta que caiu faria a tela dizer
  // "nenhuma medição publicada" para um aluno com dois anos de avaliações — e
  // o avaliador concluiria que o histórico se perdeu. Uma tela que responde a
  // pergunta errada com confiança é pior que uma que admite não saber.
  if (!respostaDoHistorico.ok || !respostaDoHistorico.dados) {
    return (
      <section aria-labelledby="titulo-evolucao">
        <PageHeader id="titulo-evolucao" title={aluno.fullName} />
        <ProblemDetail
          testId="erro-do-historico"
          problem={{
            ...(respostaDoHistorico.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível carregar a evolução corporal (${respostaDoHistorico.erro?.code ?? 'erro'}). Recarregue a página — enquanto isso, esta tela não consegue dizer o que foi medido.`,
          }}
        />
        <p>
          <a href={`/students/${id}`}>Voltar para a ficha</a>
        </p>
      </section>
    );
  }

  const historico = respostaDoHistorico.dados;

  // As medições disponíveis. Falha na consulta vira lista vazia -- a tela
  // degrada para envio + gráficos em vez de não abrir.
  const medicoes = respostaDasMedicoes.ok ? (respostaDasMedicoes.dados ?? []) : [];

  /*
   * QUAL medição a tela mostra.
   *
   * `?medicao=` na URL manda, mas só se ela EXISTIR na lista: um id chutado
   * (ou o de outro aluno) cai na mais recente em vez de produzir "avaliação
   * não encontrada". Mesmo tratamento que o período inválido acima -- a query
   * é editável por quem usa, e a API continua sendo a guarda de verdade.
   *
   * Sem `?medicao=`, abre a mais recente: é a que alguém quer ver ao abrir a
   * ficha de um aluno, e a lista já vem ordenada por isso.
   */
  const escolhida =
    medicoes.find((m) => m.sessionId === medicao)?.sessionId ?? medicoes[0]?.sessionId ?? null;

  const graficos = (
    <>
      <FiltroDePeriodo
        studentId={id}
        periodoAtual={periodo}
        periodos={PERIODOS.map((p) => ({ valor: p, rotulo: ROTULO_DE_PERIODO[p] }))}
      />

      {historico.measurements.length === 0 ? (
        <EmptyState
          testId="sem-medicoes"
          title="Nenhuma medição publicada neste período."
          hint="Envie os laudos da medição acima — a avaliação é publicada na hora. Se já houve medição antes, amplie o período."
        />
      ) : (
        historico.measurements.map((comparativo) => (
          <BlocoDoTipo
            key={comparativo.type}
            comparativo={comparativo}
            fuso={historico.timezone}
          />
        ))
      )}
    </>
  );

  const linkDaFicha = (
    <p>
      <a href={`/students/${id}`} data-testid="link-ficha">
        Voltar para a ficha do aluno
      </a>
    </p>
  );

  /*
   * ALUNO SEM NENHUMA MEDIÇÃO -- a tela que existia antes.
   *
   * Sem avaliação para mostrar, o que resta é o que sempre foi útil aqui:
   * enviar o primeiro laudo. Renderizar a avaliação vazia produziria uma
   * casca de painéis com traço em toda linha, que informa menos que o
   * convite para enviar.
   */
  if (escolhida === null) {
    return (
      <section aria-labelledby="titulo-evolucao">
        <PageHeader id="titulo-evolucao" title={`Evolução corporal — ${aluno.fullName}`} />
        <EnvioDeLaudos studentId={id} />
        {graficos}
        {linkDaFicha}
      </section>
    );
  }

  /*
   * A MESMA TELA DA AVALIAÇÃO, não uma parecida.
   *
   * `AvaliacaoCompleta` é o componente que a rota `imports/[sessionId]`
   * também renderiza -- um ajuste nela aparece nos dois caminhos. O seletor
   * de medição entra no slot do cabeçalho; os gráficos por período e o envio
   * ficam abaixo, no rodapé.
   *
   * A ordem inverte o que era antes: a avaliação vem primeiro porque é o que
   * se consulta ao abrir a ficha de um aluno; o envio, que era o topo, desce
   * para junto dos gráficos -- ele é a tarefa mensal, não a leitura diária.
   */
  return (
    <AvaliacaoCompleta
      studentId={id}
      sessionId={escolhida}
      cabecalho={
        <SeletorDeMedicao
          studentId={id}
          medicoes={medicoes}
          atual={escolhida}
          timeZone={historico.timezone}
        />
      }
      rodape={
        <>
          <EnvioDeLaudos studentId={id} />
          {graficos}
          {linkDaFicha}
        </>
      }
    />
  );
}
