import type { Metadata } from 'next';

import {
  DataTable,
  EmptyState,
  EstadoSimples,
  Money,
  PageHeader,
  ProblemDetail,
} from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { FormularioDePlano } from './formulario-de-plano';

export const metadata: Metadata = {
  title: 'Planos SaaS — ArenaHub',
};

/** O que `GET /api/v1/platform/plans` devolve. */
interface PlanoNaLista {
  id: string;
  name: string;
  model: 'PER_STUDENT' | 'FIXED_MONTHLY';
  activeStudentPriceMinor: number | null;
  inactiveStudentPriceMinor: number | null;
  fixedPriceMinor: number | null;
  currency: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

/**
 * O preço do plano, escrito conforme o modelo.
 *
 * DUAS LINHAS no modelo por aluno, e não uma soma: ativo e inativo são preços
 * distintos e negociados separadamente (ADR-052 §6). Somá-los ou mostrar só um
 * esconderia metade da tabela de preço de quem está escolhendo.
 */
function preco(plano: PlanoNaLista) {
  if (plano.model === 'FIXED_MONTHLY') {
    return <Money cents={plano.fixedPriceMinor} currency={plano.currency} />;
  }

  return (
    <>
      <div>
        <Money cents={plano.activeStudentPriceMinor} currency={plano.currency} /> por ativo
      </div>
      <div>
        <Money cents={plano.inactiveStudentPriceMinor} currency={plano.currency} /> por inativo
      </div>
    </>
  );
}

/**
 * Catálogo de planos SaaS — F63, ADR-052 §5.
 *
 * ALTERAR PREÇO AQUI NÃO MEXE EM CONTRATO FECHADO, e a tela diz isso: sem o
 * aviso, quem reajusta o catálogo acreditaria estar reajustando os clientes, e
 * descobriria o contrário só na fatura.
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

  const planos = resposta.dados ?? [];

  return (
    <section aria-labelledby="titulo-planos">
      <PageHeader
        id="titulo-planos"
        title="Planos SaaS"
        breadcrumb={<span>Plataforma</span>}
      />

      <p data-testid="aviso-de-catalogo">
        Alterar o preço de um plano não muda contrato já fechado. Os contratos guardam os valores
        acordados no fechamento — o preço novo vale para os próximos.
      </p>

      <DataTable
        testId="tabela-de-planos"
        rows={planos}
        rowKey={(plano) => plano.id}
        caption="Planos SaaS oferecidos às academias"
        columns={[
          { key: 'nome', header: 'Plano', role: 'identity', render: (p) => p.name },
          {
            key: 'modelo',
            header: 'Modelo',
            render: (p) => (p.model === 'PER_STUDENT' ? 'Por aluno' : 'Fixo mensal'),
          },
          { key: 'preco', header: 'Preço mensal', role: 'value', render: preco },
          {
            key: 'situacao',
            header: 'Situação',
            role: 'state',
            render: (p) =>
              p.status === 'ACTIVE' ? (
                <EstadoSimples label="Ativo" tom="positivo" />
              ) : (
                <EstadoSimples label="Arquivado" tom="neutro" />
              ),
          },
        ]}
        empty={
          <EmptyState
            testId="planos-vazio"
            title="Nenhum plano cadastrado ainda."
            hint="Cadastre o primeiro plano para poder fechar contrato com uma academia."
          />
        }
      />

      <FormularioDePlano />
    </section>
  );
}
