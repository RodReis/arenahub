import type { Metadata } from 'next';

import { DataTable, EmptyState, PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';

export const metadata: Metadata = {
  title: 'Unidades — ArenaHub',
};

interface Unidade {
  id: string;
  code: string;
  name: string;
  timezone: string;
  status: string;
}

/**
 * Server Component: a lista e buscada no servidor e chega pronta. Sem
 * estado de carregamento no cliente, sem token exposto ao navegador.
 */
export default async function PaginaDeUnidades() {
  const resposta = await chamarApi<Unidade[]>('/api/v1/units');

  if (!resposta.ok) {
    // Negacao explicita, com o codigo estavel visivel. Tela vazia deixaria
    // o operador sem saber se nao ha unidade ou se ele nao tem permissao.
    return (
      <section aria-labelledby="titulo-unidades">
        <PageHeader id="titulo-unidades" title="Unidades" />
        {/*
          Mesma frase que ja estava na tela, agora acentuada (o plano autoriza
          so a acentuacao desta tela). O `title` do `problem+json` da API NAO
          entra no lugar dela: a frase local diz o que o operador perdeu -- as
          unidades -- e a do servidor e generica.
        */}
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para ver as unidades (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const unidades = resposta.dados ?? [];

  return (
    <section aria-labelledby="titulo-unidades">
      <PageHeader id="titulo-unidades" title="Unidades" />

      <DataTable
        testId="tabela-de-unidades"
        rows={unidades}
        rowKey={(unidade) => unidade.id}
        caption="Unidades da sua academia"
        columns={[
          { key: 'codigo', header: 'Código', numeric: true, render: (u) => u.code },
          { key: 'nome', header: 'Nome', render: (u) => u.name },
          { key: 'fuso', header: 'Fuso horário', render: (u) => u.timezone },
          {
            key: 'situacao',
            header: 'Situação',
            /*
             * Ternario, nao `StateBadge`: o §7 define 11 maquinas de estado e
             * NENHUMA e de unidade. Inventar `machine="unit"` no dicionario
             * canonico seria decisao de produto, e ela nao e minha.
             *
             * Texto, nao so cor: `M1-NFR-008` exige WCAG 2.2 AA.
             */
            render: (u) => (u.status === 'ACTIVE' ? 'Ativa' : 'Inativa'),
          },
        ]}
        empty={
          <EmptyState
            testId="lista-vazia"
            title="Nenhuma unidade cadastrada ainda."
            hint="Cadastre a primeira unidade para liberar o acesso da recepção."
          />
        }
      />
    </section>
  );
}
