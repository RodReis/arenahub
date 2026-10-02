import type { Metadata } from 'next';

import {
  Ausente,
  Breadcrumb,
  Cpf,
  DataTable,
  EmptyState,
  PageHeader,
  ProblemDetail,
  SectionCard,
  Telefone,
  TenantDateTime,
} from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { AlterarPerfil } from '../../../../src/components/alterar-perfil';
import { diaDaSemana, horaDoMinuto } from '../../../../src/students/formatar';
import { ROTULO_DE_PERFIL } from '../../../../src/team/formatar';
import { alterarPerfilDeTime } from '../../../actions/team';
import { EditarCadastro } from '../../students/[id]/editar-cadastro';
import { AlterarVinculo } from './alterar-vinculo';
import estilos from './ficha.module.css';

/** Fuso FIXO, o mesmo da ficha do aluno -- data de nascimento não tem hora. */
const FUSO_PROVISORIO = 'America/Sao_Paulo';

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

interface CadastroDoMembro {
  id: string;
  fullName: string;
  birthDate: string;
  cpf: string | null;
  status: string;
  statusReason: string | null;
  statusReasonNote: string | null;
  rg: string | null;
  registeredSex: string | null;
  contacts: {
    type: string;
    value: string;
    isPrimary: boolean;
    label: string | null;
    relationship: string | null;
  }[];
  address: {
    postalCode: string;
    street: string;
    number: string | null;
    complement: string | null;
    district: string | null;
    city: string;
    state: string;
  } | null;
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
  const [respostaDoMembro, respostaDaAgenda, respostaDoCadastro] = await Promise.all([
    chamarApi<MembroDeTime>(`/api/v1/team/${id}`),
    chamarApi<OcorrenciaDeAgenda[]>(`/api/v1/team/${id}/agenda`),
    // O membro do time É um `Student` (ADR-061): o cadastro completo — CPF,
    // nascimento, contato — vem da mesma rota que a ficha do aluno usa.
    chamarApi<CadastroDoMembro>(`/api/v1/students/${id}`),
  ]);

  if (!respostaDoMembro.ok || !respostaDoMembro.dados) {
    const codigo = respostaDoMembro.erro?.code ?? 'erro';

    return (
      <section aria-labelledby="titulo-ficha-de-time">
        <PageHeader
          id="titulo-ficha-de-time"
          title="Ficha do time"
          breadcrumb={<Breadcrumb trilha={[{ rotulo: 'Time', href: '/team' }, { rotulo: 'Ficha do time' }]} />}
        />
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
      </section>
    );
  }

  const membro = respostaDoMembro.dados;
  const cadastro = respostaDoCadastro.ok ? respostaDoCadastro.dados : undefined;
  const contatos = cadastro?.contacts ?? [];
  const telefonePrincipal =
    contatos.find((contato) => contato.type === 'PHONE' && contato.isPrimary)?.value ??
    contatos.find((contato) => contato.type === 'PHONE')?.value ??
    contatos.find((contato) => contato.type === 'WHATSAPP')?.value ??
    null;
  const email = contatos.find((contato) => contato.type === 'EMAIL')?.value ?? null;

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
        breadcrumb={<Breadcrumb trilha={[{ rotulo: 'Time', href: '/team' }, { rotulo: membro.fullName }]} />}
      />

      <SectionCard
        title="Dados básicos"
        testId="dados-do-membro"
        actions={
          cadastro ? (
            <EditarCadastro
              studentId={cadastro.id}
              nomeDoAluno={cadastro.fullName}
              status={cadastro.status}
              statusReason={cadastro.statusReason}
              statusReasonNote={cadastro.statusReasonNote}
              version={cadastro.version}
              fullName={cadastro.fullName}
              birthDate={cadastro.birthDate}
              cpf={cadastro.cpf}
              rg={cadastro.rg}
              registeredSex={cadastro.registeredSex}
              contacts={contatos}
              address={cadastro.address}
            />
          ) : null
        }
      >
        <dl className={estilos['dados']}>
          <dt>Matrícula</dt>
          <dd data-testid="matricula">{membro.membershipNumber}</dd>

          <dt>Perfil</dt>
          <dd data-testid="perfil">{ROTULO_DE_PERFIL[membro.profile] ?? membro.profile}</dd>

          {cadastro ? (
            <>
              <dt>Nascimento</dt>
              <dd>
                <TenantDateTime iso={cadastro.birthDate} timeZone={FUSO_PROVISORIO} format="date" />
              </dd>

              <dt>CPF</dt>
              <dd>{cadastro.cpf ? <Cpf value={cadastro.cpf} /> : 'não informado'}</dd>

              <dt>Telefone</dt>
              <dd data-testid="telefone-do-membro">
                <Telefone numero={telefonePrincipal} testId="telefone-principal" />
              </dd>

              <dt>E-mail</dt>
              <dd data-testid="email-do-membro">{email ? email : <Ausente />}</dd>
            </>
          ) : null}
        </dl>

        {/* Sem a leitura do cadastro a ficha não esconde a falta: diz que ela existe. */}
        {cadastro ? null : (
          <ProblemDetail
            testId="cadastro-indisponivel"
            problem={{
              ...(respostaDoCadastro.erro ?? {
                type: 'about:blank',
                status: 0,
                code: 'erro',
                correlationId: '',
              }),
              title: `Não foi possível carregar o cadastro completo deste membro (${respostaDoCadastro.erro?.code ?? 'erro'}). Nascimento, CPF e contato não aparecem, e a edição fica indisponível.`,
            }}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Trocar perfil"
        summary="Move esta pessoa entre aluno, professor, funcionário e administrador."
      >
        <AlterarPerfil
          nomeDoCampoDeId="teamMemberId"
          id={membro.id}
          perfilAtual={membro.profile}
          version={membro.version}
          acao={alterarPerfilDeTime}
        />
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
