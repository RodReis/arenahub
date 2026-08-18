import { Body, Controller, Get, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import {
  BillingRepository,
  type InvoiceComItens,
  type InvoiceComTimeline,
} from './billing.repository.js';

const esquemaDeAbertura = z
  .object({
    subscriptionId: z.uuid(),
    /**
     * Data de referencia do ciclo. Normalizada para o primeiro dia do mes
     * pelo dominio -- e o que da a unicidade de INV-066.
     *
     * Entra por parametro em vez de `new Date()` no servidor porque o ciclo
     * precisa ser reproduzivel: reprocessar agosto em setembro nao pode
     * abrir a invoice de setembro.
     */
    emQue: z.iso.datetime(),
  })
  .strict();

const esquemaDePagamentoManual = z
  .object({
    /**
     * Centavos, inteiro. INV-065 -- o schema recusa fracionario ANTES de
     * chegar ao dominio, que recusa de novo. Duas barreiras porque valor
     * vindo de fora e a entrada classica de float em dinheiro.
     */
    amountMinor: z.number().int().min(0),
    paidAt: z.iso.datetime(),
    /**
     * Razao obrigatoria: com a dupla permissao fora do MVP 2, a trilha e o
     * unico controle que sobrou. Trilha sem motivo nao explica nada depois
     * (ADR-027, consequencia 3).
     */
    reason: z.string().min(3).max(300),
  })
  .strict();

interface InvoiceItemDto {
  description: string;
  quantity: number;
  unitAmountMinor: number;
  totalMinor: number;
}

interface PagamentoDto {
  id: string;
  method: string;
  status: string;
  amountMinor: number;
  paidAt: string | null;
  recognizedByUserId: string | null;
}

interface InvoiceDto {
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
  items: InvoiceItemDto[];
  payments: PagamentoDto[];
}

@Controller('api/v1')
export class BillingController {
  constructor(
    private readonly billing: BillingRepository,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * Abre a invoice do periodo a partir da assinatura.
   *
   * IDEMPOTENTE: chamar duas vezes no mesmo periodo devolve a MESMA
   * invoice, com o mesmo numero. Clique duplo no botao nao cobra o aluno
   * duas vezes.
   */
  @Post('invoices')
  @RequirePermissions('billing.manage')
  async abrirInvoice(@Body() corpo: unknown): Promise<InvoiceDto> {
    const dados = esquemaDeAbertura.parse(corpo);

    const invoice = await this.billing.abrirInvoiceDoPeriodo(this.contexto.require(), {
      subscriptionId: dados.subscriptionId,
      emQue: new Date(dados.emQue),
    });

    const completa = await this.billing.timelineDaInvoice(this.contexto.require(), invoice.id);

    return this.paraDto(completa!);
  }

  /**
   * Registra pagamento manual -- dinheiro ou transferencia na recepcao.
   *
   * Permissao PROPRIA (`billing.payment.manual`), separada de
   * `billing.manage`: reconhecer dinheiro sem passar por provedor e ato
   * excepcional, e nem todo perfil do financeiro precisa dele. Mesmo
   * criterio de `access.override` na F9.
   */
  @Post('invoices/:id/manual-payment')
  @RequirePermissions('billing.payment.manual')
  async registrarPagamentoManual(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<InvoiceDto> {
    const dados = esquemaDePagamentoManual.parse(corpo);

    await this.billing.registrarPagamentoManual(
      this.contexto.require(),
      {
        invoiceId: id,
        amountMinor: dados.amountMinor,
        reason: dados.reason,
        paidAt: new Date(dados.paidAt),
      },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    const completa = await this.billing.timelineDaInvoice(this.contexto.require(), id);

    return this.paraDto(completa!);
  }

  @Get('students/:id/invoices')
  @RequirePermissions('billing.read')
  async listarDoAluno(@Param('id') id: string): Promise<InvoiceDto[]> {
    const invoices = await this.billing.listarInvoicesDoAluno(this.contexto.require(), id);

    return invoices.map((invoice) => this.paraDto(invoice));
  }

  /** Timeline financeira: o controle detectivo do ADR-027. */
  @Get('invoices/:id')
  @RequirePermissions('billing.read')
  async detalhar(@Param('id') id: string): Promise<InvoiceDto> {
    const invoice = await this.billing.timelineDaInvoice(this.contexto.require(), id);

    if (!invoice) {
      throw new NotFoundException('Invoice nao encontrada');
    }

    return this.paraDto(invoice);
  }

  private paraDto(invoice: InvoiceComTimeline | InvoiceComItens): InvoiceDto {
    return {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      currency: invoice.currency,
      billingPeriod: invoice.billingPeriod.toISOString(),
      subtotalMinor: invoice.subtotalMinor,
      discountMinor: invoice.discountMinor,
      totalMinor: invoice.totalMinor,
      dueAt: invoice.dueAt.toISOString(),
      blockAt: invoice.blockAt?.toISOString() ?? null,
      paidAt: invoice.paidAt?.toISOString() ?? null,
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitAmountMinor: item.unitAmountMinor,
        totalMinor: item.totalMinor,
      })),
      payments: invoice.payments.map((pagamento) => ({
        id: pagamento.id,
        method: pagamento.method,
        status: pagamento.status,
        amountMinor: pagamento.amountMinor,
        paidAt: pagamento.paidAt?.toISOString() ?? null,
        recognizedByUserId: pagamento.recognizedByUserId,
      })),
    };
  }
}
