import type { Metadata } from 'next';

import { chamarApi } from '../../../lib/api/server-client';
import {
  ROTULO_DE_METODO,
  ROTULO_DE_MODO,
  ROTULO_DE_PASSAGEM,
  ROTULO_DE_RAZAO,
  instanteLegivel,
  traduzir,
} from '../../../src/operations/formatar';

export const metadata: Metadata = {
  title: 'Eventos de acesso — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Evento {
  id: string;
  occurredAt: string;
  receivedAt: string;
  gymUnitId: string;
  outcome: string;
  reason: string;
  mode: string;
  method: string;
  student: { id: string; fullName: string; membershipNumber: string } | null;
  externalUserId: string | null;
  passageState: string | null;
  correlationId: string;
}

interface Pagina {
  eventos: Evento[];
  proximoCursor: string | null;
  periodoLimitado: boolean;
}

/**
 * Eventos de acesso — `M1-FR-024`.
 *
 * FILTROS NA URL, não em estado de componente. Três razões práticas: o
 * operador manda o link para o colega e chega na mesma tela; o botão voltar
 * do navegador funciona; e a página inteira continua sendo Server Component,
 * sem JavaScript para filtrar.
 */
export default async function PaginaDeEventos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;

  const texto = (chave: string): string | undefined => {
    const valor = parametros[chave];

    return typeof valor === 'string' && valor !== '' ? valor : undefined;
  };

  const consulta = new URLSearchParams();

  for (const chave of ['from', 'to', 'outcome', 'mode', 'gymUnitId', 'studentId', 'cursor']) {
    const valor = texto(chave);

    if (valor) consulta.set(chave, valor);
  }

  consulta.set('limit', '50');

  const resposta = await chamarApi<Pagina>(`/api/v1/access-events?${consulta.toString()}`);

  if (!resposta.ok) {
    return (
      <section aria-labelledby="titulo-eventos">
        <h1 id="titulo-eventos">Eventos de acesso</h1>
        <p role="alert" data-testid="erro-de-permissao">
          Sem permissão para consultar eventos ({resposta.erro?.code ?? 'erro'}).
        </p>
      </section>
    );
  }

  const pagina = resposta.dados!;

  const proximaUrl = (): string => {
    if (!pagina.proximoCursor) return '';

    const proxima = new URLSearchParams(consulta);

    proxima.set('cursor', pagina.proximoCursor);
    proxima.delete('limit');

    return `/access-events?${proxima.toString()}`;
  };

  return (
    <section aria-labelledby="titulo-eventos">
      <h1 id="titulo-eventos">Eventos de acesso</h1>

      {/* GET, não Server Action: filtro é navegação, e navegação vai na URL. */}
      <form method="get" action="/access-events">
        <p>
          <label htmlFor="de">De</label>
          <input type="datetime-local" id="de" name="from" defaultValue={texto('from') ?? ''} />

          <label htmlFor="ate">Até</label>
          <input type="datetime-local" id="ate" name="to" defaultValue={texto('to') ?? ''} />
        </p>

        <p>
          <label htmlFor="resultado">Resultado</label>
          <select id="resultado" name="outcome" defaultValue={texto('outcome') ?? ''}>
            <option value="">Todos</option>
            <option value="ALLOW">Liberado</option>
            <option value="DENY">Negado</option>
          </select>

          <label htmlFor="modo">Origem</label>
          <select id="modo" name="mode" defaultValue={texto('mode') ?? ''}>
            <option value="">Todas</option>
            <option value="ONLINE">Online</option>
            <option value="OVERRIDE">Liberação manual</option>
          </select>
        </p>

        <button type="submit" data-testid="filtrar">
          Filtrar
        </button>
      </form>

      {pagina.periodoLimitado ? (
        // `role="status"`: é informação sobre o resultado, não erro do
        // operador. Sem o aviso, ele acharia que o período foi respeitado.
        <p role="status" data-testid="periodo-limitado">
          O período pedido é maior que o máximo de consulta. Mostrando os 31 dias mais
          recentes. Para um intervalo maior, use a exportação.
        </p>
      ) : null}

      {pagina.eventos.length === 0 ? (
        <p data-testid="sem-eventos">
          Nenhum evento no período. Ajuste os filtros ou amplie o intervalo.
        </p>
      ) : (
        <table data-testid="tabela-de-eventos">
          <caption>Eventos, do mais recente para o mais antigo</caption>
          <thead>
            <tr>
              <th scope="col">Quando</th>
              <th scope="col">Aluno</th>
              <th scope="col">Resultado</th>
              <th scope="col">Motivo</th>
              <th scope="col">Origem</th>
              <th scope="col">Método</th>
              <th scope="col">Passagem</th>
            </tr>
          </thead>
          <tbody>
            {pagina.eventos.map((evento) => (
              <tr key={evento.id} data-testid={`evento-${evento.id}`}>
                <td>
                  <time dateTime={evento.occurredAt}>{instanteLegivel(evento.occurredAt)}</time>
                </td>
                <td>
                  {evento.student ? (
                    `${evento.student.fullName} (${evento.student.membershipNumber})`
                  ) : (
                    // Sem aluno resolvido, mostra o que o leitor viu -- é a
                    // única pista de quem tentou passar.
                    <span data-testid="aluno-nao-identificado">
                      não identificado{evento.externalUserId ? ` (id ${evento.externalUserId})` : ''}
                    </span>
                  )}
                </td>
                <td>{evento.outcome === 'ALLOW' ? 'Liberado' : 'Negado'}</td>
                <td>{traduzir(ROTULO_DE_RAZAO, evento.reason)}</td>
                <td>{traduzir(ROTULO_DE_MODO, evento.mode)}</td>
                <td>{traduzir(ROTULO_DE_METODO, evento.method)}</td>
                <td>
                  {evento.passageState
                    ? traduzir(ROTULO_DE_PASSAGEM, evento.passageState)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pagina.proximoCursor ? (
        <p>
          <a href={proximaUrl()} data-testid="proxima-pagina">
            Próxima página
          </a>
        </p>
      ) : null}
    </section>
  );
}
