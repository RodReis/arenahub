import type { Metadata } from 'next';

import { PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { CatalogoDePlanos, type PlanoNaLista } from './catalogo-de-planos';
import estilos from './planos.module.css';

export const metadata: Metadata = {
  title: 'Planos SaaS — ArenaHub',
};

/**
 * Catálogo de planos SaaS — F63, ADR-052 §5.
 *
 * ALTERAR PREÇO AQUI NÃO MEXE EM CONTRATO FECHADO, e a tela diz isso antes da
 * tabela: sem o aviso, quem reajusta o catálogo acreditaria estar reajustando
 * os clientes, e descobriria o contrário só na fatura.
 *
 * Server Component: a lista chega pronta do servidor. A tabela e o formulário
 * compartilham estado (editar preenche o formulário), e é o `CatalogoDePlanos`
 * que faz essa ligação — do lado do cliente, sem buscar nada.
 */
export default async function PaginaDePlanos() {
  const resposta = await chamarApi<PlanoNaLista[]>('/api/v1/platform/plans');

  if (!resposta.ok) {
    return (
      <section aria-labelledby="titulo-planos">
        <PageHeader id="titulo-planos" title="Planos SaaS" />
        <ProblemDetail
          testId="erro-de-planos"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para administrar a plataforma (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  return (
    <section className={estilos['pagina']} aria-labelledby="titulo-planos">
      <PageHeader id="titulo-planos" title="Planos SaaS" breadcrumb={<span>Plataforma</span>} />

      <CatalogoDePlanos planos={resposta.dados ?? []} />
    </section>
  );
}
