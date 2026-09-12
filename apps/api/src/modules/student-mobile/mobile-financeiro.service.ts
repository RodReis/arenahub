import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import { BillingRepository, type InvoiceComItens } from '../billing/billing.repository.js';
import { ConsultarTentativaUseCase } from '../billing/consultar-tentativa.use-case.js';
import {
  CriarCheckoutDeCartaoUseCase,
  type CheckoutCriado,
} from '../billing/criar-checkout-de-cartao.use-case.js';
import {
  CriarCobrancaPixUseCase,
  type CobrancaPixCriada,
} from '../billing/criar-cobranca-pix.use-case.js';
import { EmitirReciboUseCase, type ReciboEmitido } from '../billing/emitir-recibo.use-case.js';
import type { StudentChannelContext } from '../student-identity/student-identity.service.js';
import { tenantContextDoAluno } from './contexto-do-aluno.js';

/**
 * Uma invoice ou tentativa que nao pertence ao aluno da sessao: mesma
 * resposta de "nao existe" (404), nunca "existe mas nao e sua" -- diferenciar
 * revelaria a um aluno que outro id e valido.
 */
export class NaoEncontradoParaAlunoError extends ErroDeDominio {
  constructor() {
    super('MOBILE_BILLING_NOT_FOUND', 404, 'Recurso financeiro nao encontrado');
  }
}

export interface InvoiceDoApp {
  readonly invoiceId: string;
  readonly status: string;
  readonly vencimentoEm: string;
  readonly pagoEm: string | null;
  readonly valorEmCentavos: number;
  readonly moeda: string;
}

export interface RespostaDeInvoices {
  readonly asOf: string;
  readonly invoices: readonly InvoiceDoApp[];
}

export interface TentativaDoApp {
  readonly paymentAttemptId: string;
  readonly status: string;
  readonly statusDaFatura: string;
  readonly pagoEm: string | null;
  readonly receiptId: string | null;
  readonly paymentId: string | null;
}

/**
 * Financeiro do app do aluno -- Slice 4.3, `M4-FR-009`/`M4-FR-010`.
 *
 * ---------------------------------------------------------------------------
 * ESTE SERVICE NAO COBRA NINGUEM. ELE SO CHAMA OS CASOS DE USO DO MVP 2.
 * ---------------------------------------------------------------------------
 *
 * Mesmo desenho de `kiosk-pagamento.service.ts` (F52): reusa
 * `CriarCobrancaPixUseCase`, `CriarCheckoutDeCartaoUseCase` e
 * `ConsultarTentativaUseCase` sem reimplementar nada -- idempotencia (indice
 * parcial do cartao, reuso de tentativa PENDING do PIX) e `M4-BR-001`
 * (retorno do checkout nunca confirma pagamento; so o webhook confirma,
 * INV-081) ja vem de graca dos casos de uso.
 *
 * A DIFERENCA para o totem: aqui o ALUNO ESCOLHE qual invoice pagar (o totem
 * resolve sozinho a mais antiga em aberto). Como `CriarCobrancaPixUseCase` e
 * `ConsultarTentativaUseCase` escopam so por TENANT -- correto para quem os
 * chama do painel --, este service confere ANTES que o `invoiceId`/
 * `paymentAttemptId`/`paymentId` recebido e mesmo de uma invoice do aluno da
 * sessao. Sem isso, qualquer sessao mobile valida leria fatura ou tentativa
 * de outro aluno trocando um UUID.
 */
@Injectable()
export class MobileFinanceiroService {
  constructor(
    private readonly faturas: BillingRepository,
    private readonly pix: CriarCobrancaPixUseCase,
    private readonly cartao: CriarCheckoutDeCartaoUseCase,
    private readonly tentativa: ConsultarTentativaUseCase,
    private readonly recibo: EmitirReciboUseCase,
  ) {}

  async listarInvoices(ctx: StudentChannelContext): Promise<RespostaDeInvoices> {
    const { invoices } = await this.faturas.listarInvoicesDoAluno(
      tenantContextDoAluno(ctx),
      ctx.studentId,
    );

    return {
      asOf: new Date().toISOString(),
      invoices: invoices.map(paraInvoiceDoApp),
    };
  }

  async criarPix(
    ctx: StudentChannelContext,
    invoiceId: string,
    agora: Date,
    correlationId: string,
  ): Promise<CobrancaPixCriada> {
    const contexto = tenantContextDoAluno(ctx);
    await this.confirmarInvoiceDoAluno(ctx, invoiceId);

    return this.pix.executar(contexto, { invoiceId, agora }, correlationId);
  }

  async criarCheckout(
    ctx: StudentChannelContext,
    invoiceId: string,
    agora: Date,
    correlationId: string,
  ): Promise<CheckoutCriado> {
    const contexto = tenantContextDoAluno(ctx);
    await this.confirmarInvoiceDoAluno(ctx, invoiceId);

    return this.cartao.executar(contexto, { invoiceId, agora }, correlationId);
  }

  /**
   * `M4-BR-001`/INV-081: SO LE o que o webhook ja confirmou no nosso banco.
   * Nao consulta o provedor -- mesma razao de `ConsultarTentativaUseCase`.
   */
  async observarTentativa(
    ctx: StudentChannelContext,
    paymentAttemptId: string,
  ): Promise<TentativaDoApp> {
    const daSessao = await this.faturas.buscarTentativaDoAluno(
      tenantContextDoAluno(ctx),
      ctx.studentId,
      paymentAttemptId,
    );

    if (!daSessao) {
      throw new NaoEncontradoParaAlunoError();
    }

    const observada = await this.tentativa.executar(tenantContextDoAluno(ctx), paymentAttemptId);

    return {
      paymentAttemptId: observada.paymentAttemptId,
      status: observada.status,
      statusDaFatura: observada.invoiceStatus,
      pagoEm: observada.paidAt?.toISOString() ?? null,
      receiptId: observada.receiptId,
      paymentId: observada.paymentId,
    };
  }

  async emitirRecibo(
    ctx: StudentChannelContext,
    paymentId: string,
    agora: Date,
  ): Promise<ReciboEmitido> {
    const daSessao = await this.faturas.buscarPagamentoDoAluno(
      tenantContextDoAluno(ctx),
      ctx.studentId,
      paymentId,
    );

    if (!daSessao) {
      throw new NaoEncontradoParaAlunoError();
    }

    return this.recibo.executar(tenantContextDoAluno(ctx), { paymentId, agora });
  }

  private async confirmarInvoiceDoAluno(
    ctx: StudentChannelContext,
    invoiceId: string,
  ): Promise<void> {
    const { invoices } = await this.faturas.listarInvoicesDoAluno(
      tenantContextDoAluno(ctx),
      ctx.studentId,
    );

    if (!invoices.some((invoice) => invoice.id === invoiceId)) {
      throw new NaoEncontradoParaAlunoError();
    }
  }
}

function paraInvoiceDoApp(invoice: InvoiceComItens): InvoiceDoApp {
  return {
    invoiceId: invoice.id,
    status: invoice.status,
    vencimentoEm: invoice.dueAt.toISOString(),
    pagoEm: invoice.paidAt?.toISOString() ?? null,
    valorEmCentavos: invoice.totalMinor,
    moeda: invoice.currency,
  };
}
