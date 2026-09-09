import type { Metadata } from 'next';

import {
  DataTable,
  EmptyState,
  EstadoSimples,
  Money,
  PageHeader,
  ProblemDetail,
} from '@arenahub/ui';

import { chamarApi } from '../../../../../lib/api/server-client';
import { AcoesDoContrato } from './acoes-do-contrato';
import { FormularioDeContrato } from './formulario-de-contrato';

export const metadata: Metadata = {
  title: 'Contratos da academia — ArenaHub',
};

interface ContratoNaLista {
  id: string;
  tenantId: string;
  planId: string;
  model: 'PER_STUDENT' | 'FIXED_MONTHLY';
  activeStudentPriceMinor: number | null;
  inactiveStudentPriceMinor: number | null;
  fixedPriceMinor: number | null;
  currency: string;
  indexCode: string;
  anniversaryDay: number;
  anniversaryMonth: number;
  graceDays: number;
  issueDay: number;
  startsAt: string;
  endsAt: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'TERMINATED';
  supersedesId: string | null;
  temDocumento: boolean;
}

interface PlanoNaLista {
  id: string;
  name: string;
  model: 'PER_STUDENT' | 'FIXED_MONTHLY';
  status: 'ACTIVE' | 'ARCHIVED';
}

interface TenantEmDetalhe {
  id: string;
  displayName: string;
}

/** `2026-03-01T00:00:00.000Z` -> `01/03/2026`. Data é `@db.Date`: lê-se em UTC. */
function dia(iso: string): string {
  const data = new Date(iso);
  const d = data.getUTCDate().toString().padStart(2, '0');
  const m = (data.getUTCMonth() + 1).toString().padStart(2, '0');

  return `${d}/${m}/${data.getUTCFullYear()}`;
}

function valor(contrato: ContratoNaLista) {
  if (contrato.model === 'FIXED_MONTHLY') {
    return <Money cents={contrato.fixedPriceMinor} currency={contrato.currency} />;
  }

  return (
    <>
      <div>
        <Money cents={contrato.activeStudentPriceMinor} currency={contrato.currency} /> por ativo
      </div>
      <div>
        <Money cents={contrato.inactiveStudentPriceMinor} currency={contrato.currency} /> por inativo
      </div>
    </>
  );
}

function situacao(status: ContratoNaLista['status']) {
  if (status === 'ACTIVE') return <EstadoSimples label="Vigente" tom="positivo" />;
  if (status === 'DRAFT') return <EstadoSimples label="Rascunho" tom="neutro" />;

  return <EstadoSimples label="Encerrado" tom="neutro" />;
}

/**
 * Contratos da academia — F63, ADR-052 §8.
 *
 * TELA PRÓPRIA, e não um bloco na página do tenant: aquela já carrega cadastro,
 * situação, marca e elevação, e contrato é o assunto mais pesado dos cinco --
 * fechar um é irreversível, e o ato merece uma tela em que ele seja o único
 * assunto.
 *
 * OS VALORES DA TABELA SÃO OS DO CONTRATO, não os do plano atual. É o aceite
 * da fatia, e a tela seria o lugar mais fácil de quebrá-lo: bastaria juntar o
 * preço do plano ao nome dele para a coluna passar a mentir sobre o que a
 * academia paga.
 */
export default async function PaginaDeContratos({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const [respostaDeContratos, respostaDePlanos, respostaDoTenant] = await Promise.all([
    chamarApi<ContratoNaLista[]>(
      `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/contracts`,
    ),
    chamarApi<PlanoNaLista[]>('/api/v1/platform/plans'),
    chamarApi<TenantEmDetalhe>(`/api/v1/platform/tenants/${encodeURIComponent(tenantId)}`),
  ]);

  if (!respostaDeContratos.ok) {
    return (
      <section aria-labelledby="titulo-contratos">
        <PageHeader id="titulo-contratos" title="Contratos" />
        <ProblemDetail
          testId="erro-de-contratos"
          problem={{
            ...(respostaDeContratos.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível carregar os contratos (${respostaDeContratos.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const contratos = respostaDeContratos.dados ?? [];
  /*
   * SÓ PLANO ATIVO entra na lista de escolha: plano arquivado não fecha
   * contrato novo (ADR-052 §8), e oferecê-lo produziria uma recusa da API
   * depois de a pessoa ter preenchido a tela inteira.
   */
  const planos = (respostaDePlanos.dados ?? []).filter((plano) => plano.status === 'ACTIVE');
  const nomeDaAcademia = respostaDoTenant.dados?.displayName ?? 'Academia';

  return (
    <section aria-labelledby="titulo-contratos">
      <PageHeader
        id="titulo-contratos"
        title="Contratos"
        breadcrumb={
          <span>
            <a href="/platform">Plataforma</a> ·{' '}
            <a href={`/platform/${tenantId}`}>{nomeDaAcademia}</a>
          </span>
        }
      />

      <DataTable
        testId="tabela-de-contratos"
        rows={contratos}
        rowKey={(contrato) => contrato.id}
        caption={`Contratos do ArenaHub com ${nomeDaAcademia}`}
        columns={[
          {
            key: 'vigencia',
            header: 'Vigência',
            role: 'identity',
            render: (c) => (
              <>
                {dia(c.startsAt)}
                {c.endsAt ? ` até ${dia(c.endsAt)}` : ' — sem prazo'}
              </>
            ),
          },
          {
            key: 'modelo',
            header: 'Modelo',
            render: (c) => (c.model === 'PER_STUDENT' ? 'Por aluno' : 'Fixo mensal'),
          },
          { key: 'valor', header: 'Valor acordado', role: 'value', render: valor },
          {
            key: 'reajuste',
            header: 'Reajuste',
            render: (c) =>
              c.model === 'FIXED_MONTHLY'
                ? `${c.indexCode}, dia ${c.anniversaryDay}/${c.anniversaryMonth}`
                : '—',
          },
          { key: 'situacao', header: 'Situação', role: 'state', render: (c) => situacao(c.status) },
          {
            key: 'acoes',
            header: 'Ações',
            render: (c) => (
              <AcoesDoContrato
                contratoId={c.id}
                tenantId={tenantId}
                status={c.status}
                temDocumento={c.temDocumento}
              />
            ),
          },
        ]}
        empty={
          <EmptyState
            testId="contratos-vazio"
            title="Nenhum contrato com esta academia ainda."
            hint="Abra um contrato para registrar o plano e os valores acordados."
          />
        }
      />

      <FormularioDeContrato tenantId={tenantId} planos={planos} />
    </section>
  );
}
