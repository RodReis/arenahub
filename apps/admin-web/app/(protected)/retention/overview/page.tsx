import type { Metadata } from 'next';

import { EmptyState, PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import estilos from './overview.module.css';

export const metadata: Metadata = {
  title: 'Visão geral de retenção — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Pipeline {
  state: 'SAUDAVEL' | 'ATRASADO' | 'DESLIGADO' | 'NUNCA_RODOU';
  hoursSinceLastRun: number | null;
}

interface Overview {
  pipeline: Pipeline;
  riskQueue: Record<string, number>;
  taskQueue: Record<string, number>;
}

/** Rótulo por banda, na ordem de risco crescente (PRD §7). */
const BANDAS: readonly { chave: string; rotulo: string }[] = [
  { chave: 'BAIXO', rotulo: 'Baixo' },
  { chave: 'MEDIO', rotulo: 'Médio' },
  { chave: 'ALTO', rotulo: 'Alto' },
  { chave: 'CRITICO', rotulo: 'Crítico' },
];

/** Rótulo por estado de tarefa, na ordem do fluxo (`domain/tarefa-de-retencao.ts`). */
const ESTADOS: readonly { chave: string; rotulo: string }[] = [
  { chave: 'ABERTA', rotulo: 'Aberta' },
  { chave: 'ATRIBUIDA', rotulo: 'Atribuída' },
  { chave: 'EM_ATENDIMENTO', rotulo: 'Em atendimento' },
  { chave: 'CONCLUIDA', rotulo: 'Concluída' },
  { chave: 'DISPENSADA', rotulo: 'Dispensada' },
  { chave: 'EXPIRADA', rotulo: 'Expirada' },
];

const ROTULO_DO_PIPELINE: Readonly<Record<Pipeline['state'], string>> = {
  SAUDAVEL: 'Saudável',
  ATRASADO: 'Atrasado',
  DESLIGADO: 'Desligado (kill switch)',
  NUNCA_RODOU: 'Nunca rodou',
};

/** Tom do bloco de pipeline -- so os dois estados que exigem atenção tingem
 * a superfície (mesmo critério de severidade do painel financeiro). */
function tomDoPipeline(estado: Pipeline['state']): 'danger' | 'risk' | undefined {
  if (estado === 'NUNCA_RODOU') return 'danger';
  if (estado === 'ATRASADO') return 'risk';
  return undefined;
}

/**
 * Visão geral do pipeline de retenção (F75, `SPEC-075` §3.2, #341).
 *
 * SEM QUERY PRÓPRIA -- `GET /retention/overview` já soma o que `/retention/
 * scores` e `/retention/tasks` devolvem elemento a elemento (F37/F38). Esta
 * tela só lê o agregado e desenha três blocos: saúde do pipeline, fila de
 * risco por banda, fila de tarefas por estado.
 */
export default async function VisaoGeralDeRetencaoPage() {
  const resposta = await chamarApi<Overview>('/api/v1/retention/overview');

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-retencao">
        <PageHeader id="titulo-retencao" title="Visão geral de retenção" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível carregar a visão geral de retenção (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const overview = resposta.dados;
  const tom = tomDoPipeline(overview.pipeline.state);
  const totalNaFila = Object.values(overview.riskQueue).reduce((soma, valor) => soma + valor, 0);
  const totalDeTarefas = Object.values(overview.taskQueue).reduce((soma, valor) => soma + valor, 0);

  return (
    <section aria-labelledby="titulo-retencao">
      <PageHeader
        id="titulo-retencao"
        title="Visão geral de retenção"
        breadcrumb={<span>Retenção</span>}
      />

      <section className={estilos['faixaDeKpi']} aria-label="Estado do pipeline">
        <div className={estilos['kpi']} {...(tom ? { 'data-tom': tom } : {})}>
          <p className={estilos['kpiRotulo']}>Pipeline</p>
          <p className={estilos['kpiValor']} data-testid="estado-do-pipeline">
            {ROTULO_DO_PIPELINE[overview.pipeline.state]}
          </p>
          <p className={estilos['kpiApoio']}>
            {overview.pipeline.hoursSinceLastRun === null
              ? 'sem execução registrada'
              : `última execução há ${overview.pipeline.hoursSinceLastRun}h`}
          </p>
        </div>

        <div className={estilos['kpi']}>
          <p className={estilos['kpiRotulo']}>Fila de risco</p>
          <p className={estilos['kpiValor']} data-testid="total-da-fila-de-risco">
            {totalNaFila}
          </p>
          <p className={estilos['kpiApoio']}>aluno(s) com score no período de leitura</p>
        </div>

        <div className={estilos['kpi']}>
          <p className={estilos['kpiRotulo']}>Fila de tarefas</p>
          <p className={estilos['kpiValor']} data-testid="total-da-fila-de-tarefas">
            {totalDeTarefas}
          </p>
          <p className={estilos['kpiApoio']}>tarefa(s) geradas no período de leitura</p>
        </div>
      </section>

      <div className={estilos['duasColunas']}>
        <div className={estilos['cartao']}>
          <h2 className={estilos['tituloDoCartao']}>Fila de risco por banda</h2>
          {totalNaFila === 0 ? (
            <EmptyState
              testId="sem-score-na-fila"
              title="Nenhum score na fila"
              hint="Nenhum aluno pontuado no recorte de leitura atual."
            />
          ) : (
            <div data-testid="fila-de-risco-por-banda">
              {BANDAS.map((banda) => (
                <div key={banda.chave} className={estilos['linhaDeContagem']}>
                  <span>{banda.rotulo}</span>
                  <strong>{overview.riskQueue[banda.chave] ?? 0}</strong>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={estilos['cartao']}>
          <h2 className={estilos['tituloDoCartao']}>Fila de tarefas por estado</h2>
          {totalDeTarefas === 0 ? (
            <EmptyState
              testId="sem-tarefa-na-fila"
              title="Nenhuma tarefa na fila"
              hint="Nenhuma tarefa de retenção gerada no dia."
            />
          ) : (
            <div data-testid="fila-de-tarefas-por-estado">
              {ESTADOS.filter((estado) => (overview.taskQueue[estado.chave] ?? 0) > 0).map(
                (estado) => (
                  <div key={estado.chave} className={estilos['linhaDeContagem']}>
                    <span>{estado.rotulo}</span>
                    <strong>{overview.taskQueue[estado.chave] ?? 0}</strong>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
