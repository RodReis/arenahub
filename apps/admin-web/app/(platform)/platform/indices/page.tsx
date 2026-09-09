import type { Metadata } from 'next';

import { DataTable, EmptyState, PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { FormularioDeIndice } from './formulario-de-indice';

export const metadata: Metadata = {
  title: 'Histórico do índice — ArenaHub',
};

interface ValorDeIndice {
  id: string;
  code: string;
  competencia: string;
  variationBasisPoints: number;
}

/** `440` -> `0,44%`. O banco guarda milésimos de ponto; o olho lê porcento. */
function porcento(basisPoints: number): string {
  const valor = (basisPoints / 1000).toFixed(2).replace('.', ',');

  return `${valor}%`;
}

/** `2026-03` -> `03/2026`. */
function competencia(mes: string): string {
  const [ano, numero] = mes.split('-');

  return `${numero}/${ano}`;
}

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

  const valores = resposta.dados ?? [];

  return (
    <section aria-labelledby="titulo-indices">
      <PageHeader
        id="titulo-indices"
        title={`Histórico do ${codigo}`}
        breadcrumb={<span>Plataforma</span>}
      />

      <p data-testid="aviso-do-indice">
        O valor de cada mês é cadastrado à mão. A correção anual dos contratos fixos só roda quando
        todos os meses da janela estão aqui — faltando um, ela não roda e o contrato fica no valor
        anterior.
      </p>

      <DataTable
        testId="tabela-de-indices"
        rows={valores}
        rowKey={(valor) => valor.id}
        caption={`Variação mensal do ${codigo}`}
        columns={[
          {
            key: 'competencia',
            header: 'Competência',
            role: 'code',
            render: (v) => competencia(v.competencia),
          },
          {
            key: 'variacao',
            header: 'Variação do mês',
            role: 'value',
            render: (v) => porcento(v.variationBasisPoints),
          },
        ]}
        empty={
          <EmptyState
            testId="indices-vazio"
            title={`Nenhum valor de ${codigo} cadastrado ainda.`}
            hint="Cadastre a variação de cada mês para que a correção anual dos contratos fixos possa rodar."
          />
        }
      />

      <FormularioDeIndice codigo={codigo} />
    </section>
  );
}
