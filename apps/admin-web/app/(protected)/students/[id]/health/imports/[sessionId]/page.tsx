import type { Metadata } from 'next';

import { PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../../../../lib/api/server-client';
import estilos from './sessao.module.css';
import { atributosDoAparelho, comImportId, type SessaoDeRevisao } from './sessao';
import { PainelDeAnalise } from './painel-de-analise';
import { RevisaoDeCampos } from './revisao-de-campos';

export const metadata: Metadata = {
  title: 'Revisão de avaliação — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Aluno {
  fullName: string;
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
