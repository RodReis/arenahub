import type { Metadata } from 'next';

import { PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../../../../lib/api/server-client';
import estilos from './sessao.module.css';
import { PainelDeAnalise, type AtributosDoAparelho } from './painel-de-analise';
import { RevisaoDeCampos, type LinhaDeRevisao, type PodeConfirmar } from './revisao-de-campos';

export const metadata: Metadata = {
  title: 'Revisão de avaliação — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Aluno {
  fullName: string;
}

interface ArquivoDaSessao {
  importId: string;
  sourceLabel: string;
  tipoDeLaudo: string;
}

interface SessaoDeRevisao {
  sessionId: string;
  arquivos: ArquivoDaSessao[];
  linhas: LinhaDeRevisao[];
  podeConfirmar: PodeConfirmar;
}

/**
 * Resolve o `importId` dono de cada campo, casando `sourceLabel`.
 *
 * ponytail: `GET .../sessions/:id` devolve `arquivos[].sourceLabel` e
 * `linhas[].campos[].sourceLabel` separadamente, sem o par explicito --
 * casar pelo rotulo e a unica ponte disponivel sem tocar `apps/api`
 * (fora do escopo desta tarefa). Ceiling: dois arquivos com o MESMO rotulo
 * na mesma sessao ficam ambiguos, e o campo perde o `importId` (o formulario
 * ainda funciona para o vencedor; so o descarte do concorrente correspondente
 * fica pendente). Corrigir de verdade pede a API devolver o `importId` por
 * campo em `detalharSessao` (Task 5/`import.controller.ts`).
 */
function resolverImportId(
  sourceLabel: string | null,
  arquivos: readonly ArquivoDaSessao[],
): string | undefined {
  if (sourceLabel === null) return undefined;

  const candidatos = arquivos.filter((arquivo) => arquivo.sourceLabel === sourceLabel);

  return candidatos.length === 1 ? candidatos[0]!.importId : undefined;
}

function comImportId(sessao: SessaoDeRevisao): LinhaDeRevisao[] {
  return sessao.linhas.map((linha) => ({
    ...linha,
    campos: linha.campos.map((campo) => ({
      ...campo,
      importId: resolverImportId(campo.sourceLabel, sessao.arquivos),
    })),
  }));
}

/**
 * Achado do ECG -- ADR-035: `HEART_RATE` carrega texto atribuido ao
 * aparelho, nunca metrica classificada. Vem como campo comum na sessao, e
 * esta funcao so extrai o rotulo -- a REGRA de nao interpretar ja vive no
 * servidor (`body-evolution.service.ts`), aqui e so leitura.
 */
function atributosDoAparelho(sessao: SessaoDeRevisao): AtributosDoAparelho {
  for (const linha of sessao.linhas) {
    if (linha.type !== 'HEART_RATE') continue;

    const campo = linha.campos[0];

    if (campo?.sourceLabel !== null && campo?.sourceLabel !== undefined) {
      return { ecgFinding: campo.sourceLabel };
    }
  }

  return {};
}

export default async function PaginaDaRevisao({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;

  const [respostaDoAluno, respostaDaSessao] = await Promise.all([
    chamarApi<Aluno>(`/api/v1/students/${id}`),
    chamarApi<SessaoDeRevisao>(`/api/v1/assessment-imports/sessions/${sessionId}`),
  ]);

  if (!respostaDoAluno.ok || !respostaDoAluno.dados) {
    const codigo = respostaDoAluno.erro?.code ?? 'erro';

    return (
      <section aria-labelledby="titulo-revisao-erro">
        <PageHeader id="titulo-revisao-erro" title="Revisão de avaliação" />
        <ProblemDetail
          testId={codigo === 'STUDENT_NOT_FOUND' ? 'aluno-nao-encontrado' : 'erro-do-aluno'}
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
                : `Não foi possível abrir esta revisão (${codigo}).`,
          }}
        />
      </section>
    );
  }

  const aluno = respostaDoAluno.dados;

  if (!respostaDaSessao.ok || !respostaDaSessao.dados) {
    const codigo = respostaDaSessao.erro?.code ?? 'erro';

    return (
      <section aria-labelledby="titulo-revisao-erro">
        <PageHeader id="titulo-revisao-erro" title={`Revisão de avaliação — ${aluno.fullName}`} />
        <ProblemDetail
          testId={codigo === 'SESSION_NOT_FOUND' ? 'sessao-nao-encontrada' : 'erro-da-sessao'}
          problem={{
            ...(respostaDaSessao.erro ?? {
              type: 'about:blank',
              status: 0,
              code: codigo,
              correlationId: '',
            }),
            title:
              codigo === 'SESSION_NOT_FOUND'
                ? 'Sessão de revisão não encontrada.'
                : `Não foi possível carregar os arquivos desta sessão (${codigo}).`,
          }}
        />
        <p>
          <a href={`/students/${id}/health`}>Voltar para a evolução corporal</a>
        </p>
      </section>
    );
  }

  const sessao = respostaDaSessao.dados;

  return (
    <section aria-labelledby="titulo-revisao">
      <PageHeader id="titulo-revisao" title={`Revisão de avaliação — ${aluno.fullName}`} />

      <ul className={estilos['arquivos']}>
        {sessao.arquivos.map((arquivo) => (
          <li key={arquivo.importId} className={estilos['arquivo']}>
            {arquivo.sourceLabel} — {arquivo.tipoDeLaudo}
          </li>
        ))}
      </ul>

      <div className={estilos['tela']}>
        <RevisaoDeCampos
          studentId={id}
          sessionId={sessionId}
          linhas={comImportId(sessao)}
          podeConfirmar={sessao.podeConfirmar}
        />
        <PainelDeAnalise atributos={atributosDoAparelho(sessao)} />
      </div>

      <p>
        <a href={`/students/${id}/health`} data-testid="link-evolucao">
          Voltar para a evolução corporal
        </a>
      </p>
    </section>
  );
}
