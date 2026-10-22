import type { Metadata } from 'next';

import {
  Breadcrumb,
  Button,
  Icon,
  PageHeader,
  ProblemDetail,
  Tabs,
  TenantDateTime,
} from '@arenahub/ui';

import { chamarApi } from '../../../../../lib/api/server-client';
import { hojeEmBrasilia, idadeEm, type Sexo } from '../../../../../src/health/indicadores';
import estilos from './avaliacao.module.css';
import { FichaDeAvaliacao, type Rascunho } from './ficha';
import { HistoricoDeAvaliacoes, type AvaliacaoDoHistorico } from './historico';
import { medidasPorTipo, serieDoHistorico, type AvaliacaoDaApi } from './serie';

export const metadata: Metadata = {
  title: 'Avaliação física — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Aluno {
  id: string;
  fullName: string;
  birthDate: string;
  registeredSex: string | null;
}

interface Unidade {
  status: string;
  timezone?: string;
}

const ROTULO_DO_SEXO: Record<Sexo, string> = { MALE: 'Masculino', FEMALE: 'Feminino' };

function sexoDo(registrado: string | null): Sexo | null {
  return registrado === 'MALE' || registrado === 'FEMALE' ? registrado : null;
}

/**
 * Ficha de avaliação física do professor — F91 (SPEC-091).
 *
 * Duas abas: a ficha nova (ou o rascunho em edição) e o histórico mês a mês —
 * pedido do PI em 22/10/2026: "vão ser feitas todo mês".
 */
export default async function PaginaDaAvaliacao({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string; rascunho?: string }>;
}) {
  const { id } = await params;
  const { aba, rascunho: rascunhoId } = await searchParams;

  const [respostaDoAluno, respostaDasAvaliacoes, respostaDasUnidades] = await Promise.all([
    chamarApi<Aluno>(`/api/v1/students/${id}`),
    chamarApi<AvaliacaoDaApi[]>(`/api/v1/students/${id}/assessments`),
    chamarApi<Unidade[]>('/api/v1/units'),
  ]);

  const trilha = (nome?: string) => (
    <Breadcrumb
      trilha={[
        { rotulo: 'Alunos', href: '/students' },
        ...(nome ? [{ rotulo: nome, href: `/students/${id}` }] : []),
        { rotulo: 'Avaliação física' },
      ]}
    />
  );

  if (!respostaDoAluno.ok || !respostaDoAluno.dados) {
    const codigo = respostaDoAluno.erro?.code ?? 'erro';

    return (
      <section aria-labelledby="titulo-avaliacao">
        <PageHeader id="titulo-avaliacao" title="Avaliação física" breadcrumb={trilha()} />
        <ProblemDetail
          testId="erro-da-avaliacao"
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
                : `Não foi possível abrir a ficha (${codigo}).`,
          }}
        />
      </section>
    );
  }

  const aluno = respostaDoAluno.dados;
  const sexo = sexoDo(aluno.registeredSex);
  const hoje = hojeEmBrasilia();
  const idade = idadeEm(aluno.birthDate, hoje);
  const fuso =
    (respostaDasUnidades.dados ?? []).find((u) => u.status === 'ACTIVE')?.timezone ??
    'America/Sao_Paulo';

  // Falha no histórico não é histórico vazio: a aba diz que não carregou.
  const avaliacoes = respostaDasAvaliacoes.ok ? (respostaDasAvaliacoes.dados ?? []) : null;
  const publicadas = serieDoHistorico(avaliacoes ?? []);
  const rascunhos = (avaliacoes ?? []).filter((a) => a.status === 'DRAFT');
  const ultima = publicadas.at(-1);

  const emEdicao = rascunhos.find((a) => a.id === rascunhoId);
  const rascunho: Rascunho | undefined = emEdicao && {
    id: emEdicao.id,
    assessedOn: emEdicao.assessedAt.slice(0, 10),
    notes: emEdicao.notes ?? '',
    medidas: medidasPorTipo(emEdicao),
  };

  const historico: AvaliacaoDoHistorico[] = publicadas.map((a) => ({
    id: a.id,
    assessedAt: a.assessedAt,
    medidas: medidasPorTipo(a),
  }));

  const resumo = [
    idade === null ? 'Idade não informada' : `${idade} anos`,
    sexo === null ? 'Sexo não informado' : ROTULO_DO_SEXO[sexo],
  ].join(' · ');

  return (
    <section aria-labelledby="titulo-avaliacao" className={estilos['pagina']}>
      <PageHeader
        id="titulo-avaliacao"
        title={aluno.fullName}
        breadcrumb={trilha(aluno.fullName)}
        actions={
          <Button variant="ghost" href={`/students/${id}/health`}>
            <Icon name="trending-up" />
            Gráficos de evolução
          </Button>
        }
      />
      <p className={estilos['resumo']} data-testid="resumo-do-aluno">
        {resumo} ·{' '}
        {ultima ? (
          <>
            última avaliação em <TenantDateTime iso={ultima.assessedAt} timeZone={fuso} format="date" />
          </>
        ) : (
          'primeira avaliação'
        )}
      </p>

      <Tabs
        key={aba ?? 'ficha'}
        label="Seções da avaliação física"
        defaultId={aba === 'historico' ? 'historico' : 'ficha'}
        abas={[
          {
            id: 'ficha',
            label: rascunho ? 'Rascunho' : 'Nova avaliação',
            icon: rascunho ? 'pencil' : 'file-text',
            content: (
              <FichaDeAvaliacao
                key={rascunho?.id ?? 'nova'}
                studentId={id}
                nascimento={aluno.birthDate}
                sexo={sexo}
                hoje={hoje}
                rascunho={rascunho}
                outrosRascunhos={rascunhos
                  .filter((r) => r.id !== rascunho?.id)
                  .map((r) => ({ id: r.id, assessedOn: r.assessedAt.slice(0, 10) }))}
              />
            ),
          },
          {
            id: 'historico',
            label: 'Histórico',
            icon: 'history',
            contador: publicadas.length,
            content:
              avaliacoes === null ? (
                <ProblemDetail
                  testId="erro-do-historico"
                  problem={{
                    ...(respostaDasAvaliacoes.erro ?? {
                      type: 'about:blank',
                      status: 0,
                      code: 'erro',
                      correlationId: '',
                    }),
                    title: 'Não foi possível carregar o histórico. Recarregue a página.',
                  }}
                />
              ) : (
                <HistoricoDeAvaliacoes
                  avaliacoes={historico}
                  nascimento={aluno.birthDate}
                  sexo={sexo}
                  fuso={fuso}
                />
              ),
          },
        ]}
      />
    </section>
  );
}
