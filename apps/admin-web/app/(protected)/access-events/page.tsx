import type { Metadata } from 'next';

import {
  Ausente,
  DataTable,
  EmptyState,
  PageHeader,
  ProblemDetail,
  StateBadge,
  TenantDateTime,
} from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { ROTULO_DE_METODO, ROTULO_DE_MODO, traduzir } from '../../../src/operations/formatar';

/**
 * Fuso FIXO, preservado de `instanteLegivel` -- mesma divida das outras telas.
 * O evento traz `gymUnitId`, nao o fuso da unidade.
 */
const FUSO_PROVISORIO = 'America/Sao_Paulo';

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
        <PageHeader id="titulo-eventos" title="Eventos de acesso" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para consultar eventos (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
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
      <PageHeader id="titulo-eventos" title="Eventos de acesso" />

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

      <DataTable
        testId="tabela-de-eventos"
        rows={pagina.eventos}
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
            key: 'aluno',
            header: 'Aluno',
            render: (evento) =>
              evento.student ? (
                `${evento.student.fullName} (${evento.student.membershipNumber})`
              ) : (
                // Sem aluno resolvido, mostra o que o leitor viu -- é a
                // única pista de quem tentou passar.
                <span data-testid="aluno-nao-identificado">
                  não identificado{evento.externalUserId ? ` (id ${evento.externalUserId})` : ''}
                </span>
              ),
          },
          {
            key: 'resultado',
            header: 'Resultado',
            /*
             * Ternario preservado: `ALLOW`/`DENY` e o RESULTADO da decisao,
             * nao um estado de maquina -- a razao ao lado e que carrega o
             * badge.
             */
            render: (e) => (e.outcome === 'ALLOW' ? 'Liberado' : 'Negado'),
          },
          {
            key: 'motivo',
            header: 'Motivo',
            /*
             * `ROTULO_DE_RAZAO` morreu: as 8 frases estavam identicas ao
             * dicionario canonico, que as herdou desta tela por serem as que
             * dizem O QUE ACONTECEU ("o plano vale em outra unidade"), nao o
             * que o sistema concluiu.
             */
            render: (e) => <StateBadge machine="accessReason" state={e.reason} />,
          },
          { key: 'origem', header: 'Origem', render: (e) => traduzir(ROTULO_DE_MODO, e.mode) },
          { key: 'metodo', header: 'Método', render: (e) => traduzir(ROTULO_DE_METODO, e.method) },
          {
            key: 'passagem',
            header: 'Passagem',
            /*
             * `NOT_APPLICABLE` deixa de ser `'—'` e passa a dizer "Não confirma
             * giro" (PI, 16/08/2026): o travessao colapsava "equipamento nao
             * confirma giro" com "dado ausente", que e o oposto do que este
             * estado existe para impedir.
             */
            render: (e) =>
              e.passageState ? <StateBadge machine="passage" state={e.passageState} /> : <Ausente />,
          },
        ]}
        {...(pagina.proximoCursor ? { nextHref: proximaUrl() } : {})}
        empty={
          <EmptyState
            testId="sem-eventos"
            title="Nenhum evento no período."
            hint="Ajuste os filtros ou amplie o intervalo."
          />
        }
      />
    </section>
  );
}
