import type { Metadata } from 'next';

import { EmptyState, PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';

import { ExcecaoDeAula } from './excecao-de-aula';
import { FormularioDeAula, type Modalidade, type Professor } from './formulario-de-aula';
import estilos from './page.module.css';

export const metadata: Metadata = {
  title: 'Agenda de aulas — ArenaHub',
};

interface Unidade {
  id: string;
  name: string;
}

interface ModalidadeDaApi {
  id: string;
  gymUnitId: string;
  name: string;
  isActive: boolean;
}

interface AulaDaApi {
  id: string;
  gymUnitId: string;
  modalityId: string;
  trainerId: string | null;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  capacity: number;
  isActive: boolean;
}

const DIAS_DA_SEMANA = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
];

/** `480` → `"08:00"`. */
function formatarHorario(minutos: number): string {
  const hora = Math.floor(minutos / 60)
    .toString()
    .padStart(2, '0');
  const minuto = (minutos % 60).toString().padStart(2, '0');

  return `${hora}:${minuto}`;
}

/**
 * Agenda de aulas -- F77 (SPEC-077, ADR-061).
 *
 * Server Component: unidade, modalidade, professor e a grade da semana vêm
 * prontos do servidor. A escolha de unidade vive no `?unidade=` da URL,
 * mesmo mecanismo do `SeletorDeUnidade` global da topbar (F57) -- não um
 * segundo seletor local que divergiria do de cima.
 */
export default async function PaginaDeAulas({
  searchParams,
}: {
  searchParams: Promise<{ unidade?: string }>;
}) {
  const { unidade: unitId } = await searchParams;

  const respostaDeUnidades = await chamarApi<Unidade[]>('/api/v1/units');

  if (!respostaDeUnidades.ok) {
    return (
      <section aria-labelledby="titulo-aulas">
        <PageHeader id="titulo-aulas" title="Agenda de aulas" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(respostaDeUnidades.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para ver a agenda (${respostaDeUnidades.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const unidades = respostaDeUnidades.dados ?? [];

  if (!unitId) {
    return (
      <section aria-labelledby="titulo-aulas">
        <PageHeader id="titulo-aulas" title="Agenda de aulas" breadcrumb={<span>Operação</span>} />
        <EmptyState
          testId="aulas-sem-unidade"
          title="Escolha uma unidade"
          hint={
            unidades.length === 0
              ? 'Nenhuma unidade ativa cadastrada. Cadastre uma em Unidades para a agenda ter o que mostrar.'
              : 'Use o seletor no topo. A grade é sempre de uma unidade por vez -- cada unidade da Arena Positiva tem horário e professor próprios.'
          }
        />
      </section>
    );
  }

  const [respostaDeModalidades, respostaDeAulas, respostaDeProfessores] = await Promise.all([
    chamarApi<ModalidadeDaApi[]>(`/api/v1/units/${unitId}/modalities?onlyActive=true`),
    chamarApi<AulaDaApi[]>(`/api/v1/units/${unitId}/classes`),
    chamarApi<Professor[]>(`/api/v1/students/trainers?gymUnitId=${unitId}`),
  ]);

  const modalidades: Modalidade[] = respostaDeModalidades.dados ?? [];
  const aulas = (respostaDeAulas.dados ?? []).filter((a) => a.isActive);
  const professores: Professor[] = respostaDeProfessores.dados ?? [];

  const modalidadePorId = new Map(modalidades.map((m) => [m.id, m.name]));
  const professorPorId = new Map(professores.map((p) => [p.id, p.fullName]));

  const porDia = new Map<number, AulaDaApi[]>();
  for (const aula of aulas) {
    const lista = porDia.get(aula.dayOfWeek) ?? [];
    lista.push(aula);
    lista.sort((a, b) => a.startMinute - b.startMinute);
    porDia.set(aula.dayOfWeek, lista);
  }

  return (
    <section aria-labelledby="titulo-aulas">
      <PageHeader
        id="titulo-aulas"
        title="Agenda de aulas"
        breadcrumb={<span>Operação</span>}
        actions={
          <FormularioDeAula gymUnitId={unitId} modalidades={modalidades} professores={professores} />
        }
      />

      {aulas.length === 0 ? (
        <EmptyState
          testId="aulas-vazio"
          title="Nenhuma aula cadastrada nesta unidade ainda."
          hint="Cadastre a primeira aula para a grade da semana aparecer aqui."
        />
      ) : (
        <div className={estilos['grade']} data-testid="grade-de-aulas">
          {DIAS_DA_SEMANA.map((nomeDoDia, dia) => (
            <div key={dia} className={estilos['dia']}>
              <h2 className={estilos['nomeDoDia']}>{nomeDoDia}</h2>

              {(porDia.get(dia) ?? []).length === 0 ? (
                <p className={estilos['diaVazio']}>Sem aula</p>
              ) : (
                (porDia.get(dia) ?? []).map((aula) => (
                  <div key={aula.id} className={estilos['cartaoDeAula']} data-testid={`aula-${aula.id}`}>
                    <span className={estilos['horarioDaAula']}>
                      {formatarHorario(aula.startMinute)} · {aula.durationMinutes} min
                    </span>
                    <p className={estilos['modalidadeDaAula']}>
                      {modalidadePorId.get(aula.modalityId) ?? aula.modalityId}
                    </p>
                    <span className={estilos['professorDaAula']}>
                      {aula.trainerId
                        ? (professorPorId.get(aula.trainerId) ?? 'Professor')
                        : 'Sem professor definido'}
                      {' · '}
                      {aula.capacity} vagas
                    </span>

                    <div className={estilos['acoesDaAula']}>
                      <ExcecaoDeAula
                        gymUnitId={unitId}
                        classId={aula.id}
                        modalityName={modalidadePorId.get(aula.modalityId) ?? ''}
                        professores={professores}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
