'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { paraCentavos } from '../../src/billing/dinheiro';

/**
 * Financeiro — F12, Slice 2.1.
 *
 * Regra que esta fatia NÃO viola (ADR-003): pagamento não controla acesso.
 * Registrar o dinheiro aqui fecha a invoice; quem move o direito de entrar é
 * o entitlement, e ele não é tocado por nenhuma ação deste arquivo.
 *
 * Dinheiro é INTEIRO EM CENTAVOS em todo o caminho (INV-065). A conversão de
 * "150,00" para `15000` mora em `src/billing/dinheiro.ts`, testada em
 * separado — regra de dinheiro precisa de teste, e testar Server Action
 * carregaria o Next inteiro para exercitar uma conta.
 */

const esquemaDeAbertura = z.object({
  subscriptionId: z.string().uuid('Selecione a assinatura'),
});

const esquemaDePagamento = z.object({
  invoiceId: z.string().uuid(),
  valor: z.string().trim().min(1, 'Informe o valor recebido'),
  reason: z
    .string()
    .trim()
    .min(3, 'Descreva o motivo — a auditoria depende disso')
    .max(300, 'Motivo longo demais'),
});

export interface EstadoDaInvoice {
  erro?: string;
  sucesso?: { invoiceId: string; number: number };
}

export interface EstadoDoPagamento {
  erro?: string;
  sucesso?: { invoiceId: string; creditoGerado: boolean };
}

/**
 * Mensagens por código estável, nunca a mensagem crua do servidor.
 *
 * A recepção precisa saber O QUE FAZER, não qual invariante quebrou.
 */
const MENSAGEM: Record<string, string> = {
  VALIDATION_FAILED: 'Confira os dados informados.',
  SUBSCRIPTION_NOT_FOUND: 'Assinatura não encontrada nesta academia.',
  BILLING_SETTINGS_MISSING:
    'Esta academia ainda não tem vencimento e carência configurados. Configure antes de cobrar.',
  PLAN_WITHOUT_ACTIVE_PRICE:
    'O plano não tem preço vigente para este período. Cadastre o preço antes de gerar a cobrança.',
  INVOICE_NOT_FOUND: 'Cobrança não encontrada nesta academia.',
  INVOICE_INVALID_TRANSITION:
    'Esta cobrança não aceita pagamento na situação atual — provavelmente já foi paga ou cancelada.',
  BILLING_INVALID_INVOICE:
    'Pagamento parcial não é aceito: a cobrança só fecha com o valor integral.',
  BILLING_INVALID_MONETARY_AMOUNT: 'Valor inválido. Informe em reais, com até duas casas.',
  FORBIDDEN: 'Seu perfil não tem permissão para esta ação.',
};

function mensagemDe(code: string | undefined, padrao: string): string {
  return (code ? MENSAGEM[code] : undefined) ?? padrao;
}

interface InvoiceRetornada {
  id: string;
  number: number;
  status: string;
  totalMinor: number;
  payments: { amountMinor: number }[];
}

/**
 * Saida comum de PIX e cartao -- o que a Task 11 (`CobrancaPorQr`) consome
 * para desenhar QR, copia-e-cola e link de checkout.
 */
export interface EstadoDaCobrancaPorQr {
  erro?: string;
  sucesso?: {
    paymentAttemptId: string;
    qrCodeDataUri: string | null;
    copiaECola: string | null;
    checkoutUrl: string | null;
    expiresAt: string;
    amountMinor: number;
    currency: string;
  };
}

interface CobrancaPixRetornada {
  paymentAttemptId: string;
  externalPaymentId: string;
  copiaECola: string;
  qrCodeDataUri: string;
  expiresAt: string;
  amountMinor: number;
  currency: string;
}

/**
 * Gera a cobranca PIX da invoice -- Task 10/11, F53.
 *
 * NAO CONFIRMA PAGAMENTO: devolve QR e copia-e-cola. A tela da Task 11
 * consulta `payment-attempts/:id` (leitura barata) ate a invoice ficar paga.
 */
export async function iniciarCobrancaPix(invoiceId: string): Promise<EstadoDaCobrancaPorQr> {
  const resposta = await chamarApi<CobrancaPixRetornada>(
    `/api/v1/invoices/${invoiceId}/payments/pix`,
    { metodo: 'POST' },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível gerar o PIX.') };
  }

  return {
    sucesso: {
      paymentAttemptId: resposta.dados.paymentAttemptId,
      qrCodeDataUri: resposta.dados.qrCodeDataUri,
      copiaECola: resposta.dados.copiaECola,
      checkoutUrl: null,
      expiresAt: resposta.dados.expiresAt,
      amountMinor: resposta.dados.amountMinor,
      currency: resposta.dados.currency,
    },
  };
}

interface CheckoutDeCartaoRetornado {
  paymentAttemptId: string;
  externalPaymentId: string;
  checkoutUrl: string;
  qrCodeDataUri: string;
  expiresAt: string;
  amountMinor: number;
  currency: string;
}

/**
 * Gera o checkout hospedado de cartao da invoice -- Task 10/11, F53.
 *
 * O cartao vai do celular do aluno direto para o provedor (INV-098,
 * ADR-032): esta tela nunca ve numero de cartao.
 *
 * ⚠️ BLOQUEIO CONHECIDO: o caso de uso `CriarCheckoutDeCartaoUseCase`
 * (Task 4) existe, mas nao ha rota HTTP exposta para ele em
 * `billing.controller.ts` -- a Task 4, como escrita no plano, criou so o
 * caso de uso e o registro em `billing.module.ts`, sem controller. Chamar
 * esta action hoje devolve 404 ate essa rota (`POST
 * /api/v1/invoices/:id/payments/card-checkout`, nome espelhando o PIX) ser
 * criada. Documentado no relatorio da Task 10 -- decisao tecnica registrada,
 * nao workaround silencioso: adicionar controller esta fora do escopo desta
 * task (arquivos de `apps/api` nao listados no brief).
 */
export async function iniciarCheckoutDeCartao(
  invoiceId: string,
): Promise<EstadoDaCobrancaPorQr> {
  const resposta = await chamarApi<CheckoutDeCartaoRetornado>(
    `/api/v1/invoices/${invoiceId}/payments/card-checkout`,
    { metodo: 'POST' },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível gerar o checkout do cartão.') };
  }

  return {
    sucesso: {
      paymentAttemptId: resposta.dados.paymentAttemptId,
      qrCodeDataUri: resposta.dados.qrCodeDataUri,
      copiaECola: null,
      checkoutUrl: resposta.dados.checkoutUrl,
      expiresAt: resposta.dados.expiresAt,
      amountMinor: resposta.dados.amountMinor,
      currency: resposta.dados.currency,
    },
  };
}

export async function abrirCobranca(
  _anterior: EstadoDaInvoice,
  formulario: FormData,
): Promise<EstadoDaInvoice> {
  const analisado = esquemaDeAbertura.safeParse({
    subscriptionId: formulario.get('subscriptionId'),
  });

  if (!analisado.success) {
    return { erro: analisado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  const resposta = await chamarApi<InvoiceRetornada>('/api/v1/invoices', {
    metodo: 'POST',
    corpo: {
      subscriptionId: analisado.data.subscriptionId,
      // O ciclo é do mês corrente. A API normaliza para o primeiro dia, e a
      // idempotência de INV-066 garante que repetir não gera segunda cobrança.
      emQue: new Date().toISOString(),
    },
  });

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível gerar a cobrança.') };
  }

  revalidatePath('/billing');

  return { sucesso: { invoiceId: resposta.dados.id, number: resposta.dados.number } };
}

/**
 * Registra dinheiro ou transferência recebidos no balcão.
 *
 * Caminho de PRIMEIRA CLASSE, não degradado: é ele que fecha a Slice 2.1 sem
 * provedor de pagamento nenhum. A permissão é própria
 * (`billing.payment.manual`) e a API recusa quem não a tem.
 */
export async function registrarPagamentoNoBalcao(
  _anterior: EstadoDoPagamento,
  formulario: FormData,
): Promise<EstadoDoPagamento> {
  const analisado = esquemaDePagamento.safeParse({
    invoiceId: formulario.get('invoiceId'),
    valor: formulario.get('valor'),
    reason: formulario.get('reason'),
  });

  if (!analisado.success) {
    return { erro: analisado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  const amountMinor = paraCentavos(analisado.data.valor);

  if (amountMinor === null) {
    return { erro: 'Valor inválido. Informe em reais, com até duas casas — por exemplo 150,00.' };
  }

  const resposta = await chamarApi<InvoiceRetornada>(
    `/api/v1/invoices/${analisado.data.invoiceId}/manual-payment`,
    {
      metodo: 'POST',
      corpo: {
        amountMinor,
        paidAt: new Date().toISOString(),
        reason: analisado.data.reason,
      },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível registrar o pagamento.') };
  }

  revalidatePath('/billing');

  const pago = resposta.dados.payments.reduce((soma, p) => soma + p.amountMinor, 0);

  return {
    sucesso: {
      invoiceId: resposta.dados.id,
      // Sobrepagamento vira crédito do aluno (ADR-027). A tela avisa, senão o
      // troco "some" da perspectiva de quem está no balcão.
      creditoGerado: pago > resposta.dados.totalMinor,
    },
  };
}
