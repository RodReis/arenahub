import type { Metadata } from 'next';

import { Ausente, DataTable, EmptyState, Identidade, PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { ROTULO_DE_PERFIL, ROTULO_DE_VINCULO } from '../../../src/team/formatar';
import { AvisoDePerfilAlterado } from '../../../src/components/aviso-de-perfil-alterado';
import { FiltroDeTime } from './filtro-de-time';

export const metadata: Metadata = {
  title: 'Time — ArenaHub',
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

const POR_PAGINA = 20;

/**
 * Lista do time (professor/staff/admin) -- F81 (issue #415), Task 8.
 *
 * MESMO PADRÃO de `/students`: busca na URL (não em estado de componente),
 * paginação por cursor, Server Component consumindo `GET /api/v1/team`. O
 * time NÃO é entidade nova -- é `Student` com `profile != STUDENT` (ver
 * `TeamRepository`) -- e a tela segue a mesma UX para não ensinar duas
 * convenções de listagem no mesmo painel.
 */
export default async function PaginaDeTime({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;

  const texto = (chave: string): string | undefined => {
    const valor = parametros[chave];

    return typeof valor === 'string' && valor !== '' ? valor : undefined;
  };

  const termo = texto('q');
  const consulta = new URLSearchParams();

  if (termo) consulta.set('q', termo);

  const temFiltro = Boolean(termo);

  const cursor = texto('cursor');

  if (cursor) consulta.set('cursor', cursor);

  consulta.set('limit', String(POR_PAGINA));

  const resposta = await chamarApi<MembroDeTime[]>(`/api/v1/team?${consulta.toString()}`);

  if (!resposta.ok) {
    return (
      <section aria-labelledby="titulo-time">
        <PageHeader id="titulo-time" title="Time" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para consultar o time (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const membros = resposta.dados ?? [];

  /** Próxima página pelo id do último membro -- mesmo critério de `/students`. */
  const proximaUrl = (): string => {
    const ultimo = membros[membros.length - 1];

    if (!ultimo || membros.length < POR_PAGINA) return '';

    const proxima = new URLSearchParams();

    if (termo) proxima.set('q', termo);
    proxima.set('cursor', ultimo.id);

    return `/team?${proxima.toString()}`;
  };

  const proxima = proximaUrl();

  const primeiraUrl = (): string => {
    if (!cursor) return '';

    const inicio = new URLSearchParams();

    if (termo) inicio.set('q', termo);

    const consultaInicio = inicio.toString();

    return consultaInicio ? `/team?${consultaInicio}` : '/team';
  };

  const primeira = primeiraUrl();

  return (
    <section aria-labelledby="titulo-time">
      <AvisoDePerfilAlterado />
      <PageHeader id="titulo-time" title="Time" breadcrumb={<span>Cadastros</span>} />

      <FiltroDeTime termoInicial={termo ?? ''} />

      <DataTable
        testId="tabela-de-time"
        rows={membros}
        {...(resposta.total === undefined ? {} : { total: resposta.total })}
        rowKey={(membro) => membro.id}
        rowTestId={(membro) => `membro-${membro.id}`}
        caption="Time -- professores, funcionários e administradores"
        columns={[
          {
            key: 'membro',
            header: 'Nome',
            role: 'identity',
            render: (membro) => (
              <Identidade nome={membro.fullName} href={`/team/${membro.id}`} />
            ),
          },
          {
            key: 'perfil',
            header: 'Perfil',
            role: 'label',
            render: (membro) => ROTULO_DE_PERFIL[membro.profile] ?? membro.profile,
          },
          {
            key: 'vinculo',
            header: 'Vínculo',
            role: 'label',
            render: (membro) =>
              membro.employmentType ? (
                <span data-testid={`vinculo-${membro.id}`}>
                  {ROTULO_DE_VINCULO[membro.employmentType] ?? membro.employmentType}
                </span>
              ) : (
                <span data-testid={`vinculo-${membro.id}`}>
                  <Ausente />
                </span>
              ),
          },
        ]}
        {...(primeira ? { prevHref: primeira, prevLabel: 'Primeira página' } : {})}
        {...(proxima ? { nextHref: proxima } : {})}
        empty={
          <EmptyState
            testId="sem-membros"
            title={
              temFiltro
                ? 'Nenhum membro do time encontrado com esse filtro.'
                : 'Nenhum professor, funcionário ou administrador cadastrado ainda.'
            }
            {...(temFiltro ? { hint: 'Confira a grafia ou amplie a busca.' } : {})}
          />
        }
      />
    </section>
  );
}
