import type { Metadata } from 'next';

import {
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  ProblemDetail,
  StateBadge,
  TenantDateTime,
} from '@arenahub/ui';

import { chamarApi } from '../../../../../lib/api/server-client';
import { PainelDeCobranca } from './painel-de-cobranca';

export const metadata: Metadata = {
  title: 'Financeiro do aluno — ArenaHub',
};

export const dynamic = 'force-dynamic';

/**
 * Fuso FIXO -- mesma divida das outras telas do painel. A invoice traz
 * `tenant_id`, nao o fuso da unidade, e o financeiro nao e dado fisico
 * (nao tem `gym_unit_id`, por ADR-027).
 *
 * Aqui a divida DOI MAIS que nas outras telas: `INV-144` diz que o instante
 * de bloqueio por inadimplencia e no timezone da unidade, SEM fallback para
 * o tenant. Enquanto este valor for fixo, a data que a recepcao le pode
 * divergir da que o job de vencimento vai usar na F15.
 */
const FUSO_PROVISORIO = 'America/Sao_Paulo';

interface Pagamento {
  id: string;
  method: string;
  status: string;
  amountMinor: number;
  paidAt: string | null;
  recognizedByUserId: string | null;
}

interface Invoice {
  id: string;
  number: number;
  status: string;
  currency: string;
  billingPeriod: string;
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  dueAt: string;
  blockAt: string | null;
  paidAt: string | null;
  items: { description: string; quantity: number; unitAmountMinor: number; totalMinor: number }[];
  payments: Pagamento[];
}

interface Entitlement {
  id: string;
  status: string;
  subscriptionId: string | null;
}

interface Aluno {
  id: string;
  fullName: string;
}

/**
 * Financeiro do aluno — F12, Slice 2.1.
 *
 * Mora sob a ficha do aluno, e não numa área de "faturamento" solta, porque é
 * assim que a recepção trabalha: primeiro acha a pessoa, depois cobra. Uma
 * lista global de invoices seria uma tela que ninguém abre com uma pessoa na
 * frente do balcão esperando.
 *
 * ADR-003: nada aqui move direito de acesso. Registrar dinheiro fecha a
 * cobrança; entrar na academia continua sendo assunto do entitlement.
 */
export default async function PaginaFinanceiroDoAluno({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [respostaDoAluno, respostaDasInvoices, respostaDosDireitos] = await Promise.all([
    chamarApi<Aluno>(`/api/v1/students/${id}`),
    chamarApi<Invoice[]>(`/api/v1/students/${id}/invoices`),
    chamarApi<Entitlement[]>(`/api/v1/students/${id}/entitlements`),
  ]);

  if (!respostaDasInvoices.ok) {
    return (
      <section aria-labelledby="titulo-financeiro">
        <PageHeader id="titulo-financeiro" title="Financeiro" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(respostaDasInvoices.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para consultar o financeiro (${respostaDasInvoices.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const invoices = respostaDasInvoices.dados ?? [];
  const aluno = respostaDoAluno.dados;

  /*
   * A cobrança nasce da assinatura, não do aluno: é o par
   * (assinatura, competência) que dá a unicidade de INV-066. Sem assinatura
   * ativa não há o que cobrar, e o painel diz isso em vez de oferecer um
   * botão que falharia no servidor.
   */
  const assinaturaAtiva =
    (respostaDosDireitos.dados ?? []).find(
      (direito) => direito.status === 'ACTIVE' && direito.subscriptionId !== null,
    )?.subscriptionId ?? null;

  return (
    <section aria-labelledby="titulo-financeiro">
      <PageHeader
        id="titulo-financeiro"
        title={aluno ? `Financeiro — ${aluno.fullName}` : 'Financeiro'}
      />

      <DataTable
        testId="tabela-de-cobrancas"
        rows={invoices}
        rowKey={(invoice) => invoice.id}
        rowTestId={(invoice) => `cobranca-${invoice.id}`}
        caption="Cobranças do aluno, da mais recente para a mais antiga"
        columns={[
          {
            key: 'numero',
            header: 'Nº',
            render: (invoice) => <output data-numeric>{invoice.number}</output>,
          },
          {
            key: 'competencia',
            header: 'Competência',
            render: (invoice) => <TenantDateTime iso={invoice.billingPeriod} timeZone={FUSO_PROVISORIO} />,
          },
          {
            key: 'situacao',
            header: 'Situação',
            render: (invoice) => <StateBadge machine="invoice" state={invoice.status} />,
          },
          {
            key: 'valor',
            header: 'Valor',
            render: (invoice) => (
              <Money cents={invoice.totalMinor} currency={invoice.currency} />
            ),
          },
          {
            key: 'vencimento',
            header: 'Vence em',
            render: (invoice) => <TenantDateTime iso={invoice.dueAt} timeZone={FUSO_PROVISORIO} />,
          },
          {
            key: 'recebimento',
            header: 'Recebimento',
            /*
             * MANUAL aparece por extenso e com quem reconheceu. Com a dupla
             * permissão fora do MVP 2 (ADR-027), esta coluna é o controle
             * DETECTIVO que sobrou: sem ela, dinheiro registrado no balcão
             * não teria onde ser percebido.
             */
            render: (invoice) =>
              invoice.payments.length === 0 ? (
                <span>—</span>
              ) : (
                <ul>
                  {invoice.payments.map((pagamento) => (
                    <li key={pagamento.id}>
                      {pagamento.method === 'MANUAL' ? 'Dinheiro no balcão' : pagamento.method}
                      {pagamento.paidAt ? (
                        <>
                          {' — '}
                          <TenantDateTime iso={pagamento.paidAt} timeZone={FUSO_PROVISORIO} format="datetime" />
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ),
          },
        ]}
        empty={
          <EmptyState
            testId="sem-cobrancas"
            title="Nenhuma cobrança gerada para este aluno."
            hint="Gere a cobrança do mês no painel abaixo."
          />
        }
      />

      <PainelDeCobranca
        subscriptionId={assinaturaAtiva}
        invoicesEmAberto={invoices
          .filter((invoice) => invoice.status === 'OPEN' || invoice.status === 'OVERDUE')
          .map((invoice) => ({
            id: invoice.id,
            number: invoice.number,
            totalMinor: invoice.totalMinor,
            currency: invoice.currency,
          }))}
      />
    </section>
  );
}
