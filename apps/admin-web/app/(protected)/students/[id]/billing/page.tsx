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

import { formatarMesAno } from '../../../../../src/billing/meses-pagaveis';
import { estadoExibido, faturaEmDestaque, venceEmDaLinha } from '../../../../../src/billing/vencimento';
import { chamarApi } from '../../../../../lib/api/server-client';
import { consultarMesesPagaveis } from '../../../../actions/billing';
import { CancelarPagamento } from './cancelar-pagamento';
import { PainelDeCobranca } from './painel-de-cobranca';
import { SeloDoCanal } from './recebimento';
import { FORMAS } from './seletor-de-forma';
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
  /** A API diz se a grade oferece o cancelamento (regra do PI, 05/10/2026). */
  cancellable: boolean;
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
  /** Ate quando a fatura paga cobre (F88); nulo em paga antiga e nas nao pagas. */
  coverageEndsAt: string | null;
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

/** Mesmo rotulo do `Recebimento`; pagamento anterior ao registro de canal (`receivedVia` nulo) cai em "Dinheiro". */
function rotuloDoCanal(canal: string | null): string {
  return FORMAS.find((forma) => forma.forma === canal)?.rotulo ?? 'Dinheiro';
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
          /*
           * DOIS BLOCOS -- COBRANCA e RECEBIMENTO (decisao do PI, 05/10/2026,
           * DS-PAINEL §3.5b). A linha descreve duas coisas: o que o aluno deve
           * e o dinheiro que entrou contra isso. O grupo no cabecalho e a
           * divisoria vertical dizem de que lado o olho esta.
           */
          {
            key: 'numero',
            header: 'Nº',
            group: 'Cobrança',
            /* `code`: numero de fatura IDENTIFICA, nao se soma -- a esquerda. */
            role: 'code',
            render: (invoice) => invoice.number,
          },
          {
            key: 'competencia',
            header: 'Competência',
            group: 'Cobrança',
            role: 'moment',
            /* Competencia e MES, nao instante -- mesmo rotulo dos chips do balcao. */
            render: (invoice) => (
              <span className={estilos['competencia']}>{formatarMesAno(invoice.billingPeriod.slice(0, 7))}</span>
            ),
          },
          {
            key: 'situacao',
            header: 'Situação',
            group: 'Cobrança',
            role: 'state',
            /* `estadoExibido`: OPEN com vencimento passado aparece Vencida antes
             * de o job gravar OVERDUE; com vencimento futuro, "A vencer". */
            render: (invoice) => (
              <StateBadge machine="invoice" state={estadoExibido(invoice, agora, timezoneDaUnidade)} />
            ),
          },
          {
            key: 'valor',
            header: 'Valor',
            group: 'Cobrança',
            role: 'value',
            render: (invoice) => <Money cents={invoice.totalMinor} currency={invoice.currency} />,
          },
          {
            key: 'vencimento',
            header: 'Vence em',
            group: 'Cobrança',
            role: 'moment',
            /* F88: paga mostra ate quando cobre; as demais, o vencimento (DATA em meia-noite UTC). */
            render: (invoice) => (
              <TenantDateTime iso={venceEmDaLinha(invoice)} timeZone={timezoneDaUnidade} format="date" />
            ),
          },
          {
            key: 'forma',
            header: 'Forma',
            group: 'Recebimento',
            role: 'label',
            /*
             * Um selo por pagamento. MANUAL aparece com quem reconheceu na
             * auditoria (ADR-027); esta coluna e o controle DETECTIVO que a
             * recepcao ve -- por isso o canal tem cor propria e forte.
             */
            render: (invoice) =>
              invoice.payments.length === 0 ? (
                <span className={estilos['semRecebimento']} aria-label="sem recebimento">—</span>
              ) : (
                <ul className={estilos['pilha']}>
                  {invoice.payments.map((pagamento) => (
                    <li key={pagamento.id}>
                      <SeloDoCanal pagamento={pagamento} />
                    </li>
                  ))}
                </ul>
              ),
          },
          {
            key: 'pagoEm',
            header: 'Pago em',
            group: 'Recebimento',
            role: 'moment',
            /*
             * COLUNA PROPRIA, nao colada no selo: selos de largura diferente
             * ("PIX" x "Dinheiro") empurravam a data e nenhuma linha alinhava
             * com a de baixo. Pilha com a mesma altura da coluna Forma, para
             * o 2º pagamento de um mes ficar na mesma linha do selo dele.
             */
            render: (invoice) =>
              invoice.payments.length === 0 ? null : (
                <ul className={estilos['pilha']}>
                  {invoice.payments.map((pagamento) => (
                    <li key={pagamento.id}>
                      {pagamento.paidAt ? (
                        <TenantDateTime iso={pagamento.paidAt} timeZone={timezoneDaUnidade} format="datetime" />
                      ) : (
                        <span aria-label="data não registrada">—</span>
                      )}
                    </li>
                  ))}
                </ul>
              ),
          },
          {
            key: 'acao',
            header: 'Ação',
            role: 'actions',
            /*
             * ICONE, no padrao da coluna Acao da Lista de Alunos (decisao do
             * PI, 05/10/2026; DS-PAINEL §5.3b). Uma posicao por pagamento,
             * alinhada a pilha das colunas ao lado; so aparece o icone quando
             * a API diz `cancellable` (adiantado ou duplicado no mes) -- mes
             * que ja passou nao ganha icone desabilitado, ganha ausencia.
             */
            render: (invoice) =>
              invoice.payments.some((pagamento) => pagamento.cancellable) ? (
                <ul className={estilos['pilha']}>
                  {invoice.payments.map((pagamento) => (
                    <li key={pagamento.id}>
                      {pagamento.cancellable ? (
                        <CancelarPagamento
                          paymentId={pagamento.id}
                          resumo={`${formatarMesAno(invoice.billingPeriod.slice(0, 7))}, ${rotuloDoCanal(pagamento.receivedVia)}`}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null,
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
