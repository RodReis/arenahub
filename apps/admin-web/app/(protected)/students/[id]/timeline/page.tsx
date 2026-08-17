import type { Metadata } from 'next';

import {
  Ausente,
  DataTable,
  EmptyState,
  PageHeader,
  ProblemDetail,
  TenantDateTime,
} from '@arenahub/ui';

import { chamarApi } from '../../../../../lib/api/server-client';
import { traduzir } from '../../../../../src/operations/formatar';
import { ROTULO_DE_EVENTO } from '../../../../../src/students/formatar';

/** Fuso FIXO, preservado de `instanteLegivel` -- mesma divida das outras telas. */
const FUSO_PROVISORIO = 'America/Sao_Paulo';

export const metadata: Metadata = {
  title: 'Histórico do aluno — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Evento {
  id: string;
  type: string;
  occurredAt: string;
  payload: unknown;
}

interface Pagina {
  items: Evento[];
  proximoCursor?: string | null;
  nextCursor?: string | null;
}

interface Aluno {
  fullName: string;
  membershipNumber: string;
}

/**
 * Detalhe do evento em uma frase.
 *
 * O `payload` é JSON livre, com shape variável por tipo — o servidor não
 * promete campos. Por isso a leitura é defensiva: o que existir vira texto, o
 * resto some. Renderizar o JSON cru transformaria a página em despejo de
 * banco.
 */
function detalhe(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return '';

  const campos = payload as Record<string, unknown>;
  const partes: string[] = [];

  for (const [chave, valor] of Object.entries(campos)) {
    if (typeof valor === 'string' || typeof valor === 'number') {
      partes.push(`${chave}: ${valor}`);
    }
  }

  return partes.join(' · ');
}

/**
 * Histórico administrativo do aluno — Slice 1.2.
 *
 * Responde "o que aconteceu com este cadastro e quando". É a trilha que
 * sustenta uma auditoria: cada mudança de situação, cada assinatura, cada
 * direito de acesso concedido ou revogado.
 */
export default async function PaginaDaTimeline({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const parametros = await searchParams;

  const cursorAtual = typeof parametros['cursor'] === 'string' ? parametros['cursor'] : undefined;

  const consulta = new URLSearchParams();

  if (cursorAtual) consulta.set('cursor', cursorAtual);

  consulta.set('limit', '50');

  const [respostaDoAluno, resposta] = await Promise.all([
    chamarApi<Aluno>(`/api/v1/students/${id}`),
    chamarApi<Pagina>(`/api/v1/students/${id}/timeline?${consulta.toString()}`),
  ]);

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-timeline">
        <PageHeader id="titulo-timeline" title="Histórico administrativo" />
        <ProblemDetail
          testId="erro-da-timeline"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível carregar o histórico (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
        <p>
          <a href={`/students/${id}`}>Voltar para a ficha</a>
        </p>
      </section>
    );
  }

  const pagina = resposta.dados;
  const eventos = pagina.items ?? [];
  const proximoCursor = pagina.proximoCursor ?? pagina.nextCursor ?? null;
  const aluno = respostaDoAluno.dados;

  return (
    <section aria-labelledby="titulo-timeline">
      <PageHeader id="titulo-timeline" title="Histórico administrativo" />

      {aluno ? (
        <p data-testid="aluno-da-timeline">
          {aluno.fullName} ({aluno.membershipNumber})
        </p>
      ) : null}

      <p>
        <a href={`/students/${id}`}>Voltar para a ficha</a>
      </p>

      <DataTable
        testId="tabela-da-timeline"
        rows={eventos}
        rowKey={(evento) => evento.id}
        rowTestId={(evento) => `evento-${evento.id}`}
        caption="Eventos, do mais recente para o mais antigo"
        columns={[
          {
            key: 'quando',
            header: 'Quando',
            render: (e) => <TenantDateTime iso={e.occurredAt} timeZone={FUSO_PROVISORIO} />,
          },
          {
            key: 'evento',
            header: 'O que aconteceu',
            /*
             * `ROTULO_DE_EVENTO` FICA: tipo de evento de timeline nao e maquina
             * de estado, e o §7 define 11 e nenhuma o cobre. Entra no achado
             * dos oito dicionarios sem casa, que e decisao do Cowork + PI.
             */
            render: (e) => traduzir(ROTULO_DE_EVENTO, e.type),
          },
          {
            key: 'detalhe',
            header: 'Detalhe',
            render: (e) => detalhe(e.payload) || <Ausente />,
          },
        ]}
        {...(proximoCursor
          ? {
              nextHref: `/students/${id}/timeline?cursor=${encodeURIComponent(proximoCursor)}`,
            }
          : {})}
        empty={
          <EmptyState
            testId="sem-eventos-na-timeline"
            title="Nenhum evento registrado para este aluno ainda."
          />
        }
      />
    </section>
  );
}
