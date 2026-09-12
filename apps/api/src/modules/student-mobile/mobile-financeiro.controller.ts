import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { StudentSessionGuard } from '../student-identity/student-session.guard.js';
import { MobileFinanceiroService } from './mobile-financeiro.service.js';

const ESQUEMA_DA_INVOICE = {
  type: 'object',
  required: ['invoiceId', 'status', 'vencimentoEm', 'pagoEm', 'valorEmCentavos', 'moeda'],
  properties: {
    invoiceId: { type: 'string', format: 'uuid' },
    status: { type: 'string' },
    vencimentoEm: { type: 'string', format: 'date-time' },
    pagoEm: { type: 'string', format: 'date-time', nullable: true },
    valorEmCentavos: { type: 'integer' },
    moeda: { type: 'string' },
  },
};

const ESQUEMA_DA_COBRANCA = {
  type: 'object',
  required: ['paymentAttemptId', 'expiraEm', 'valorEmCentavos', 'moeda'],
  properties: {
    paymentAttemptId: { type: 'string', format: 'uuid' },
    qrCodeDataUri: { type: 'string' },
    copiaECola: { type: 'string', nullable: true },
    checkoutUrl: { type: 'string', nullable: true },
    expiraEm: { type: 'string', format: 'date-time' },
    valorEmCentavos: { type: 'integer' },
    moeda: { type: 'string' },
  },
};

/**
 * Financeiro do app do aluno -- Slice 4.3, `M4-FR-009`/`M4-FR-010`/`M4-FR-011`.
 *
 * SEM `studentId` em rota, query ou body: o aluno da sessao vem de
 * `requisicao.studentContext` (`StudentSessionGuard`), mesmo padrao de
 * `MobilePlanoController`. O `invoiceId`/`paymentAttemptId`/`paymentId` da
 * URL SAO aceitos -- e a diferenca para o totem -- mas o service confere a
 * posse antes de qualquer coisa (ver `mobile-financeiro.service.ts`).
 */
@Public()
@UseGuards(StudentSessionGuard)
@Controller('api/v1/mobile')
export class MobileFinanceiroController {
  constructor(private readonly financeiro: MobileFinanceiroService) {}

  @Get('invoices')
  @ApiOkResponse({
    description: 'Invoices do aluno.',
    schema: {
      type: 'object',
      required: ['asOf', 'invoices'],
      properties: {
        asOf: { type: 'string' },
        invoices: { type: 'array', items: ESQUEMA_DA_INVOICE },
      },
    },
  })
  async listarInvoices(@Req() requisicao: Request) {
    const ctx = this.exigirSessao(requisicao);

    return this.financeiro.listarInvoices(ctx);
  }

  @Post('invoices/:id/pix')
  @ApiCreatedResponse({ description: 'Cobranca PIX da invoice.', schema: ESQUEMA_DA_COBRANCA })
  async criarPix(@Req() requisicao: Request, @Param('id') invoiceId: string) {
    const ctx = this.exigirSessao(requisicao);
    const agora = new Date();

    const cobranca = await this.financeiro.criarPix(
      ctx,
      invoiceId,
      agora,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return {
      paymentAttemptId: cobranca.paymentAttemptId,
      qrCodeDataUri: cobranca.qrCodeDataUri,
      copiaECola: cobranca.copiaECola,
      checkoutUrl: null,
      expiraEm: cobranca.expiresAt.toISOString(),
      valorEmCentavos: cobranca.amountMinor,
      moeda: cobranca.currency,
    };
  }

  @Post('invoices/:id/checkout')
  @ApiCreatedResponse({
    description: 'Checkout de cartao hospedado da invoice.',
    schema: ESQUEMA_DA_COBRANCA,
  })
  async criarCheckout(@Req() requisicao: Request, @Param('id') invoiceId: string) {
    const ctx = this.exigirSessao(requisicao);
    const agora = new Date();

    const checkout = await this.financeiro.criarCheckout(
      ctx,
      invoiceId,
      agora,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return {
      paymentAttemptId: checkout.paymentAttemptId,
      qrCodeDataUri: checkout.qrCodeDataUri,
      copiaECola: null,
      checkoutUrl: checkout.checkoutUrl,
      expiraEm: checkout.expiresAt.toISOString(),
      valorEmCentavos: checkout.amountMinor,
      moeda: checkout.currency,
    };
  }

  /**
   * O LACO do polling enquanto o QR esta aberto -- `M4-BR-001`: NAO confirma
   * pagamento, so le o que o webhook ja confirmou (INV-081).
   */
  @Get('payment-attempts/:id')
  @ApiOkResponse({
    description: 'Status da tentativa de pagamento.',
    schema: {
      type: 'object',
      required: ['paymentAttemptId', 'status', 'statusDaFatura', 'pagoEm', 'receiptId', 'paymentId'],
      properties: {
        paymentAttemptId: { type: 'string', format: 'uuid' },
        status: { type: 'string' },
        statusDaFatura: { type: 'string' },
        pagoEm: { type: 'string', format: 'date-time', nullable: true },
        receiptId: { type: 'string', format: 'uuid', nullable: true },
        paymentId: { type: 'string', format: 'uuid', nullable: true },
      },
    },
  })
  async observarTentativa(@Req() requisicao: Request, @Param('id') attemptId: string) {
    const ctx = this.exigirSessao(requisicao);

    return this.financeiro.observarTentativa(ctx, attemptId);
  }

  @Post('payments/:id/receipt')
  @ApiCreatedResponse({
    description: 'Recibo do pagamento, emitido ou ja existente.',
    schema: {
      type: 'object',
      required: ['receiptId', 'numero', 'verificationHash', 'snapshot'],
      properties: {
        receiptId: { type: 'string', format: 'uuid' },
        numero: { type: 'integer' },
        verificationHash: { type: 'string' },
        snapshot: { type: 'object', additionalProperties: true },
      },
    },
  })
  async emitirRecibo(@Req() requisicao: Request, @Param('id') paymentId: string) {
    const ctx = this.exigirSessao(requisicao);

    return this.financeiro.emitirRecibo(ctx, paymentId, new Date());
  }

  private exigirSessao(requisicao: Request) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    return ctx;
  }
}
