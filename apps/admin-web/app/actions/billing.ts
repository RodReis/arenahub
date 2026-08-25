'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { paraCentavos } from '../../src/billing/dinheiro';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

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
  ...MENSAGEM_DE_SESSAO,
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
  payments: { id: string; status: string; amountMinor: number }[];
}

/**
 * Saida comum de PIX e cartao -- o que a Task 11 (`CobrancaPorQr`) consome
 * para desenhar QR, copia-e-cola e link de checkout.
 */
export interface EstadoDaCobrancaPorQr {
  erro?: string;
  sucesso?: {
    paymentAttemptId: string;
    invoiceId: string;
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
      invoiceId,
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
 * Chama `POST /api/v1/invoices/:id/payments/card-checkout`, que nao e a
 * mesma rota do cartao ja tokenizado (`payments/card`, da F14): aquela cobra
 * um metodo salvo, e no balcao o aluno ainda nao tem cartao nenhum guardado.
 *
 * Cadastro incompleto volta como 422 `STUDENT_BILLING_DATA_INCOMPLETE` --
 * o servidor recusa ANTES de tocar o provedor, porque o antifraude
 * bloquearia com uma recusa generica que a recepcao leria como "o cartao nao
 * passou", quando o conserto e preencher o CPF.
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
      invoiceId,
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

/** Leitura barata da tentativa -- o que o laco de polling da Task 11 consulta. */
export interface TentativaObservada {
  invoiceStatus: string;
  receiptId: string | null;
  /** O pagamento gerado, para EMITIR o recibo quando ainda nao existe. */
  paymentId: string | null;
}

export interface EstadoDaTentativa {
  erro?: string;
  dados?: TentativaObservada;
}

/**
 * Consulta o NOSSO banco -- `GET /payment-attempts/:id`. F53, Task 11.
 *
 * DECISAO DE ARQUITETURA QUE NAO PODE SER INVERTIDA: esta e a rota do laco
 * de polling porque so le o banco, onde o webhook ja escreveu. Ela NUNCA
 * troca de lugar com `consultarStatusAtivo` -- aquela bate no provedor a
 * cada chamada, e um laco de 3 em 3s custaria ~20 chamadas externas por
 * minuto de QR aberto, por caixa (ver `ConsultarTentativaUseCase`).
 */
export async function consultarTentativa(paymentAttemptId: string): Promise<EstadoDaTentativa> {
  const resposta = await chamarApi<{
    invoiceStatus: string;
    receiptId: string | null;
    paymentId: string | null;
  }>(`/api/v1/payment-attempts/${paymentAttemptId}`);

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível consultar o pagamento.') };
  }

  return {
    dados: {
      invoiceStatus: resposta.dados.invoiceStatus,
      receiptId: resposta.dados.receiptId,
      paymentId: resposta.dados.paymentId,
    },
  };
}

export interface EstadoDoStatusAtivo {
  erro?: string;
  dados?: { statusLocal: string; statusNoProvedor: string; divergente: boolean };
}

/**
 * Consulta ativa no provedor -- `GET /payments/:id/status`. F53, Task 11.
 *
 * O botao "Conferir com o banco": UMA chamada por clique, nunca em laco --
 * e o caminho de quem nao pode esperar o polling do `payment-attempts/:id`.
 */
export async function consultarStatusAtivo(paymentAttemptId: string): Promise<EstadoDoStatusAtivo> {
  const resposta = await chamarApi<{
    statusLocal: string;
    statusNoProvedor: string;
    divergente: boolean;
  }>(`/api/v1/payments/${paymentAttemptId}/status`);

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível consultar o provedor.') };
  }

  return {
    dados: {
      statusLocal: resposta.dados.statusLocal,
      statusNoProvedor: resposta.dados.statusNoProvedor,
      divergente: resposta.dados.divergente,
    },
  };
}

export interface EstadoDoRecibo {
  erro?: string;
  sucesso?: { receiptId: string; numero: number; verificationHash: string };
}

/**
 * Recupera o recibo JA EMITIDO, em uma viagem.
 *
 * O laco do balcao ja recebe `receiptId` de `GET /payment-attempts/:id`. Ate
 * o FIX #165, a tela ignorava esse campo e redescobria o recibo com tres
 * viagens (`GET /invoices/:id` -> `POST .../receipt` -> `GET /receipts/:id`)
 * -- o oposto da razao de a rota do polling ser barata.
 */
export async function consultarReciboEmitido(receiptId: string): Promise<EstadoDoRecibo> {
  const consulta = await chamarApi<{ receiptId: string; numero: number; verificationHash: string }>(
    `/api/v1/receipts/${receiptId}`,
  );

  if (!consulta.ok || !consulta.dados) {
    return { erro: mensagemDe(consulta.erro?.code, 'Nao foi possivel confirmar o recibo.') };
  }

  return {
    sucesso: {
      receiptId: consulta.dados.receiptId,
      numero: consulta.dados.numero,
      verificationHash: consulta.dados.verificationHash,
    },
  };
}

/**
 * Emite o recibo de um pagamento e confirma a emissao com `GET /receipts/:id`.
 *
 * RECEBE O `paymentId`, nao o `invoiceId` (FIX #165). A leitura barata do
 * polling passou a devolver `paymentId` junto do `receiptId` -- de graca, o
 * `include` dela ja carregava `payment` para alcancar o recibo. Some com o
 * `GET /invoices/:id` que existia so para redescobrir qual pagamento fechou a
 * cobranca, e com o palpite embutido nele: "o ultimo CONFIRMED da lista" e
 * heuristica, enquanto o `paymentId` da tentativa e o pagamento EXATO que
 * aquela cobranca gerou.
 *
 * A CONSULTA APOS EMITIR nao e so para provar a rota GET: e o que confirma o
 * documento antes de mostra-lo na tela, com o `verificationHash` que a
 * recepcao pode conferir com o aluno.
 */
export async function emitirReciboDoPagamento(paymentId: string): Promise<EstadoDoRecibo> {
  const emissao = await chamarApi<{ receiptId: string; numero: number }>(
    `/api/v1/payments/${paymentId}/receipt`,
    { metodo: 'POST' },
  );

  if (!emissao.ok || !emissao.dados) {
    return { erro: mensagemDe(emissao.erro?.code, 'Nao foi possivel emitir o recibo.') };
  }

  return consultarReciboEmitido(emissao.dados.receiptId);
}

/**
 * Emite o recibo a partir da INVOICE -- o caminho do DINHEIRO no balcao.
 *
 * Pagamento manual nao passa pelo laco de polling: nao existe tentativa, e
 * por isso nao ha `paymentId` a consumir. Aqui a busca por invoice continua
 * sendo o unico caminho, e nao vira as tres viagens do FIX #165 -- sao duas,
 * e a primeira e a que descobre o pagamento que acabou de nascer.
 *
 * PIX e cartao NAO usam esta funcao: a tela do QR ja recebe `receiptId` e
 * `paymentId` prontos do polling.
 */
export async function emitirReciboDaInvoice(invoiceId: string): Promise<EstadoDoRecibo> {
  const respostaDaInvoice = await chamarApi<InvoiceRetornada>(`/api/v1/invoices/${invoiceId}`);

  if (!respostaDaInvoice.ok || !respostaDaInvoice.dados) {
    return {
      erro: mensagemDe(respostaDaInvoice.erro?.code, 'Nao foi possivel localizar a cobranca.'),
    };
  }

  // CONFIRMED ou REFUNDED emitem recibo (INV-069/INV-075) -- ver docblock de
  // `EmitirReciboUseCase.executar`. O mais recente e o que fechou a cobranca.
  const pagamentoConfirmado = [...respostaDaInvoice.dados.payments]
    .reverse()
    .find((pagamento) => pagamento.status === 'CONFIRMED' || pagamento.status === 'REFUNDED');

  if (!pagamentoConfirmado) {
    return { erro: 'Nenhum pagamento confirmado encontrado para esta cobranca.' };
  }

  return emitirReciboDoPagamento(pagamentoConfirmado.id);
}
