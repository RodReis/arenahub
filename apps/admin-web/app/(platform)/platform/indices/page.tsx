import type { Metadata } from 'next';

import { PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { HistoricoDoIndice, type ValorDeIndice } from './historico-do-indice';
import estilos from './indices.module.css';

export const metadata: Metadata = {
  title: 'Histórico do índice — ArenaHub',
};

/**
 * Histórico manual do índice de correção — F63, ADR-052 §7.
 *
 * ENTRADA MANUAL é decisão registrada, e não falta de tempo: a API pública do
 * Banco Central no caminho de faturamento transformaria a indisponibilidade
 * dela em fatura errada ou fatura nenhuma. Automatizar é ADR futuro.
 *
 * SEM O VALOR DE UM MÊS A CORREÇÃO NÃO RODA — é o aceite da fatia. Por isso
 * esta tela existe separada: é aqui que se resolve a recusa que a tela de
 * contratos anuncia.
 *
 * Server Component: a lista chega pronta. Tabela e formulário compartilham
 * estado (corrigir preenche o formulário), e quem liga os dois é o
 * `HistoricoDoIndice`, do lado do cliente.
 */
export default async function PaginaDeIndices({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const codigo = code ?? 'IPCA';

  const resposta = await chamarApi<ValorDeIndice[]>(
    `/api/v1/platform/index-values?code=${encodeURIComponent(codigo)}`,
  );

  if (!resposta.ok) {
    return (
      <section aria-labelledby="titulo-indices">
        <PageHeader id="titulo-indices" title="Histórico do índice" />
        <ProblemDetail
          testId="erro-de-indices"
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
    <section className={estilos['pagina']} aria-labelledby="titulo-indices">
      <PageHeader
        id="titulo-indices"
        title={`Histórico do ${codigo}`}
        breadcrumb={<span>Plataforma</span>}
      />

      <HistoricoDoIndice codigo={codigo} valores={resposta.dados ?? []} />
    </section>
  );
}
