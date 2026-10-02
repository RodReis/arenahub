import type { Metadata } from 'next';

import {
  AusenteDeAcao,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  ProblemDetail,
  StateBadge,
  TenantDateTime,
} from '@arenahub/ui';

import { formatarMesAno } from '../../../../../src/billing/meses-pagaveis';
import { estadoExibido, faturaEmDestaque } from '../../../../../src/billing/vencimento';
import { chamarApi } from '../../../../../lib/api/server-client';
import { consultarMesesPagaveis } from '../../../../actions/billing';
import { PainelDeCobranca } from './painel-de-cobranca';
import { Recebimento } from './recebimento';
import { SituacaoAtual } from './situacao-atual';

import estilos from './financeiro.module.css';

export const metadata: Metadata = {
  title: 'Financeiro do aluno — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Pagamento {
  id: string;
  method: string;
  status: string;
  amountMinor: number;
  paidAt: string | null;
  recognizedByUserId: string | null;
  /** Canal da maquininha fisica -- preenchido so quando `method = MANUAL`. */
  receivedVia: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO' | null;
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
  /** Anulavel: 308 alunos do Pacto nao tem (ADR-034). */
  cpf: string | null;
  address: { postalCode: string } | null;
}

/** Resposta de `GET /students/:id/invoices` -- fuso da unidade do aluno (INV-144, ADR-019). F53. */
interface InvoicesDoAluno {
  timezone: string;
  invoices: Invoice[];
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
    chamarApi<InvoicesDoAluno>(`/api/v1/students/${id}/invoices`),
    chamarApi<Entitlement[]>(`/api/v1/students/${id}/entitlements`),
  ]);

  if (!respostaDasInvoices.ok) {
    /*
      A MENSAGEM SEGUE O CODIGO DO ERRO, nao o contrario.

      Ate a F53 esta tela dizia "Sem permissao" para QUALQUER falha -- um 500
      do servidor e um aluno inexistente produziam a mesma frase. Passava
      despercebido porque o unico erro provavel era mesmo permissao; a F53
      tornou o 404 provavel ao fazer a rota exigir o aluno para resolver o
      fuso da unidade.

      Mandar a recepcao pedir permissao ao administrador quando o aluno foi
      excluido faz duas pessoas perderem tempo com a pergunta errada.
    */
    const codigo = respostaDasInvoices.erro?.code ?? 'erro';

    const titulo =
      respostaDasInvoices.erro?.status === 404
        ? `Aluno não encontrado (${codigo}).`
        : `Sem permissão para consultar o financeiro (${codigo}).`;

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
            title: titulo,
          }}
        />
      </section>
    );
  }

  const invoices = respostaDasInvoices.dados?.invoices ?? [];
  // Fuso da unidade de origem do aluno (INV-144, ADR-019) -- sem fallback
  // para America/Sao_Paulo: sem o dado, nao ha fuso confiavel para exibir.
  const timezoneDaUnidade = respostaDasInvoices.dados?.timezone ?? 'UTC';
  const aluno = respostaDoAluno.dados;
  const agora = new Date();

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

  /*
   * A fatura em destaque sai de `faturaEmDestaque`, e nao de um calculo local:
   * a ficha do aluno mostra o aviso de vencimento sobre a MESMA fatura, e duas
   * implementacoes divergiriam.
   */
  const invoiceEmDestaque = faturaEmDestaque(invoices);

  /*
   * PAGAR (FaixaDeMeses) precisa de ACTIVE OU SUSPENDED -- nao so ACTIVE.
   *
   * SUSPENDED e exatamente o aluno inadimplente (`aplicar-inadimplencia.
   * use-case.ts`): entitlement suspenso por atraso, mas `registrarPagamentoManual`
   * (por baixo do lote) reativa a assinatura no pagamento bem-sucedido. Negar
   * o botao de pagar a quem esta suspenso tranca o UNICO caminho de volta —
   * antes desta fatia, "Receber no balcao" nao tinha essa restricao (ver
   * commit 6c33233, `invoicesEmAberto` independia de status de entitlement).
   *
   * "Gerar cobranca do mes" (abaixo, `assinaturaAtiva`) continua so ACTIVE:
   * abrir cobranca NOVA para quem ja esta suspenso nao faz sentido.
   */
  const assinaturaParaPagamento =
    (respostaDosDireitos.dados ?? []).find(
      (direito) =>
        (direito.status === 'ACTIVE' || direito.status === 'SUSPENDED') &&
        direito.subscriptionId !== null,
    )?.subscriptionId ?? null;

  const mesesPagaveis =
    assinaturaParaPagamento !== null ? await consultarMesesPagaveis(assinaturaParaPagamento) : [];

  return (
    <section aria-labelledby="titulo-financeiro">
      <PageHeader
        id="titulo-financeiro"
        title={aluno ? `Financeiro — ${aluno.fullName}` : 'Financeiro'}
      />

      <SituacaoAtual invoice={invoiceEmDestaque} timezone={timezoneDaUnidade} agora={agora} />

      <div className={estilos['historico']}>

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
            /*
             * `code` e nao `value`: numero de fatura IDENTIFICA, nao se compara
             * nem se soma. Alinhado a direita, "7" e "1042" abririam um vao
             * irregular ate a competencia ao lado.
             *
             * O `<output data-numeric>` saiu junto: `data-numeric` so pedia
             * `tabular-nums`, que o papel `code` ja da -- e `<output>` e o
             * elemento de RESULTADO DE CALCULO, que numero de fatura nao e.
             */
            role: 'code',
            render: (invoice) => invoice.number,
          },
          {
            key: 'competencia',
            header: 'Competência',
            role: 'moment',
            /* Competencia e MES, nao instante: "01/07/2026, 00:00" sugeria uma
             * hora que o dado nao tem. Mesmo rotulo dos chips do balcao. */
            render: (invoice) => (
              <span className={estilos['competencia']}>{formatarMesAno(invoice.billingPeriod.slice(0, 7))}</span>
            ),
          },
          {
            key: 'situacao',
            header: 'Situação',
            role: 'state',
            /* `estadoExibido`: OPEN com vencimento passado aparece Vencida antes
             * de o job de inadimplencia gravar OVERDUE. */
            render: (invoice) => (
              <StateBadge machine="invoice" state={estadoExibido(invoice, agora, timezoneDaUnidade)} />
            ),
          },
          {
            key: 'valor',
            header: 'Valor',
            /* Dinheiro E o numero que se compara entre linhas -- `value` poe as
             * casas decimais na mesma coluna vertical. */
            role: 'value',
            render: (invoice) => (
              <Money cents={invoice.totalMinor} currency={invoice.currency} />
            ),
          },
          {
            key: 'vencimento',
            header: 'Vence em',
            role: 'moment',
            /* `dueAt` e DATA guardada como meia-noite UTC (`vencimento.ts`):
             * a parte `YYYY-MM-DD` mostra o dia certo, sem a "21:00" que a
             * conversao de fuso inventava. */
            render: (invoice) => (
              <TenantDateTime iso={invoice.dueAt.slice(0, 10)} timeZone={timezoneDaUnidade} format="date" />
            ),
          },
          {
            key: 'recebimento',
            header: 'Recebimento',
            /*
             * MANUAL aparece por extenso e com quem reconheceu. Com a dupla
             * permissão fora do MVP 2 (ADR-027), esta coluna é o controle
             * DETECTIVO que sobrou: sem ela, dinheiro registrado no balcão
             * não teria onde ser percebido.
             *
             * `support` e nao `actions`: a coluna e o REGISTRO do recebimento,
             * texto de apoio vindo da API -- nao tem botao nem form.
             */
            role: 'support',
            render: (invoice) =>
              invoice.payments.length === 0 ? (
                /*
                 * `AusenteDeAcao` e nao `<span>—</span>`: o travessao cru era
                 * bug de a11y silencioso -- lido como pontuacao solta, deixava
                 * quem usa leitor de tela sem saber se a fatura nao tem
                 * recebimento ou se o dado nao carregou.
                 */
                <AusenteDeAcao />
              ) : (
                <ul className={estilos['recebimentos']}>
                  {invoice.payments.map((pagamento) => (
                    <li key={pagamento.id}>
                      <Recebimento pagamento={pagamento} timezone={timezoneDaUnidade} />
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
      </div>

      <PainelDeCobranca
        subscriptionId={assinaturaAtiva}
        subscriptionIdParaPagamento={assinaturaParaPagamento}
        mesesPagaveis={mesesPagaveis}
      />
    </section>
  );
}
