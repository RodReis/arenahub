import type { Metadata } from 'next';

import { chamarApi } from '../../../../../lib/api/server-client';
import { instanteLegivel, traduzir } from '../../../../../src/operations/formatar';
import { ROTULO_DE_EVENTO } from '../../../../../src/students/formatar';

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
        <h1 id="titulo-timeline">Histórico administrativo</h1>
        <p role="alert" data-testid="erro-da-timeline">
          Não foi possível carregar o histórico ({resposta.erro?.code ?? 'erro'}).
        </p>
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
      <h1 id="titulo-timeline">Histórico administrativo</h1>

      {aluno ? (
        <p data-testid="aluno-da-timeline">
          {aluno.fullName} ({aluno.membershipNumber})
        </p>
      ) : null}

      <p>
        <a href={`/students/${id}`}>Voltar para a ficha</a>
      </p>

      {eventos.length === 0 ? (
        <p data-testid="sem-eventos-na-timeline">
          Nenhum evento registrado para este aluno ainda.
        </p>
      ) : (
        <table data-testid="tabela-da-timeline">
          <caption>Eventos, do mais recente para o mais antigo</caption>
          <thead>
            <tr>
              <th scope="col">Quando</th>
              <th scope="col">O que aconteceu</th>
              <th scope="col">Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {eventos.map((evento) => (
              <tr key={evento.id} data-testid={`evento-${evento.id}`}>
                <td>
                  <time dateTime={evento.occurredAt}>{instanteLegivel(evento.occurredAt)}</time>
                </td>
                <td>{traduzir(ROTULO_DE_EVENTO, evento.type)}</td>
                <td>{detalhe(evento.payload) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {proximoCursor ? (
        <p>
          <a
            href={`/students/${id}/timeline?cursor=${encodeURIComponent(proximoCursor)}`}
            data-testid="proxima-pagina-da-timeline"
          >
            Eventos mais antigos
          </a>
        </p>
      ) : null}
    </section>
  );
}
