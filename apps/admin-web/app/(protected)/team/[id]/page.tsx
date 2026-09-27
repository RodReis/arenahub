import type { Metadata } from 'next';

import { DataTable, EmptyState, PageHeader, ProblemDetail, SectionCard } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { diaDaSemana, horaDoMinuto } from '../../../../src/students/formatar';
import { ROTULO_DE_PERFIL } from '../../../../src/team/formatar';
import { AlterarVinculo } from './alterar-vinculo';
import estilos from './ficha.module.css';

export const metadata: Metadata = {
  title: 'Ficha do time — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface MembroDeTime {
  id: string;
  membershipNumber: string;
  fullName: string;
  profile: string;
  gymUnitId: string;
  employmentType: string | null;
  employmentStartedAt: string | null;
  version: number;
}

interface OcorrenciaDeAgenda {
  classId: string;
  modalityId: string;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  gymUnitId: string;
}

/**
 * Ficha do membro do time -- F81 (issue #415), Task 8.
 *
 * Dados básicos + vínculo editável + agenda read-only. Layout de ficha em
 * `SectionCard` (DS-PAINEL §3.7/§4.5): cada bloco é uma seção com borda
 * própria, não uma pilha de `<h2>` sem moldura -- o mesmo componente que a
 * tela de aluno passou a reusar depois de `ficha.module.css` documentar por
 * que um `<dl>` nu não serve para uma tela de consulta.
 *
 * A agenda é SÓ LEITURA nesta fatia -- ver `TeamRepository.buscarAgenda`, que
 * lê `Class.classesAsTrainer` (F77) sem escrever nada.
 */
export default async function PaginaDaFichaDeTime({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Em paralelo: as duas chamadas não dependem uma da outra.
  const [respostaDoMembro, respostaDaAgenda] = await Promise.all([
    chamarApi<MembroDeTime>(`/api/v1/team/${id}`),
    chamarApi<OcorrenciaDeAgenda[]>(`/api/v1/team/${id}/agenda`),
  ]);

  if (!respostaDoMembro.ok || !respostaDoMembro.dados) {
    const codigo = respostaDoMembro.erro?.code ?? 'erro';

    return (
      <section aria-labelledby="titulo-ficha-de-time">
        <PageHeader id="titulo-ficha-de-time" title="Ficha do time" />
        <ProblemDetail
          testId={codigo === 'TEAM_MEMBER_NOT_FOUND' ? 'membro-nao-encontrado' : 'erro-da-ficha'}
          problem={{
            ...(respostaDoMembro.erro ?? {
              type: 'about:blank',
              status: 0,
              code: codigo,
              correlationId: '',
            }),
            title:
              codigo === 'TEAM_MEMBER_NOT_FOUND'
                ? 'Membro do time não encontrado nesta academia.'
                : `Não foi possível abrir a ficha (${codigo}).`,
          }}
        />
        <p>
          <a href="/team">Voltar para a lista de time</a>
        </p>
      </section>
    );
  }

  const membro = respostaDoMembro.dados;

  // A agenda é acessório: falhar não impede ver quem é o membro nem editar o
  // vínculo. O card avisa a própria limitação, como `/students/[id]` já faz
  // com planos e unidades.
  const agenda = respostaDaAgenda.dados ?? [];
  const agendaIndisponivel = !respostaDaAgenda.ok;

  return (
    <section aria-labelledby="titulo-ficha-de-time">
      <PageHeader
        id="titulo-ficha-de-time"
        title={membro.fullName}
        breadcrumb={<a href="/team">Voltar para a lista de time</a>}
      />

      <SectionCard title="Dados básicos" testId="dados-do-membro">
        <dl className={estilos['dados']}>
          <dt>Matrícula</dt>
          <dd data-testid="matricula">{membro.membershipNumber}</dd>

          <dt>Perfil</dt>
          <dd data-testid="perfil">{ROTULO_DE_PERFIL[membro.profile] ?? membro.profile}</dd>
        </dl>
      </SectionCard>

      <SectionCard title="Vínculo" summary="Tipo de contrato e data de início.">
        <AlterarVinculo
          teamMemberId={membro.id}
          employmentType={membro.employmentType}
          employmentStartedAt={membro.employmentStartedAt}
          version={membro.version}
        />
      </SectionCard>

      <SectionCard
        title="Agenda"
        summary="Aulas em que este membro é o professor. Somente leitura nesta tela."
        encaixe
      >
        {agendaIndisponivel ? (
          <ProblemDetail
            testId="agenda-indisponivel"
            problem={{
              ...(respostaDaAgenda.erro ?? {
                type: 'about:blank',
                status: 0,
                code: 'erro',
                correlationId: '',
              }),
              title: 'Não foi possível carregar a agenda deste membro.',
            }}
          />
        ) : (
          <DataTable
            testId="tabela-de-agenda"
            rows={agenda}
            rowKey={(ocorrencia) => ocorrencia.classId}
            rowTestId={(ocorrencia) => `agenda-${ocorrencia.classId}`}
            caption="Agenda de aulas, do domingo ao sábado"
            columns={[
              {
                key: 'dia',
                header: 'Dia',
                role: 'label',
                render: (ocorrencia) => diaDaSemana(ocorrencia.dayOfWeek),
              },
              {
                key: 'horario',
                header: 'Horário',
                role: 'moment',
                render: (ocorrencia) => {
                  const fim = ocorrencia.startMinute + ocorrencia.durationMinutes;

                  return `${horaDoMinuto(ocorrencia.startMinute)}–${horaDoMinuto(fim)}`;
                },
              },
            ]}
            empty={
              <EmptyState
                testId="sem-agenda"
                title="Nenhuma aula atribuída a este membro."
                hint="A agenda é gerenciada na tela de Aulas."
              />
            }
          />
        )}
      </SectionCard>
    </section>
  );
}
