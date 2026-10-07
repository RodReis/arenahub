import { Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import {
  CreditoJaAplicadoError,
  PagamentoNaoCancelavelError,
  creditoAConsumir,
  decidirCancelamento,
  validarCancelamento,
} from './domain/cancelamento-de-pagamento.js';
import { TransicaoDeInvoiceConcorrenteError } from './domain/invoice.js';

/**
 * Cancelamento de pagamento MANUAL lancado por engano. F85, decisao do PI em
 * 05/10/2026 (`docs/superpowers/specs/2026-10-05-cancelar-pagamento-manual-design.md`).
 *
 * EMENDA DO INV-069 so para pagamento `MANUAL`: a fatura volta de `PAID` para
 * `OPEN` e o aluno volta a dever o mes. A linha do `Payment` NAO e apagada --
 * vira `CANCELLED` com autor, data e motivo, que e a trilha que o ADR-027
 * exige para dinheiro reconhecido sem provedor.
 *
 * O QUE NAO FAZ, DE PROPOSITO: nao toca em `Entitlement` nem em `Subscription`
 * (regra de arquitetura nº 1). A fatura reaberta entra no fluxo normal de
 * inadimplencia e so bloqueia quando passar de `blockAt` -- cancelar nao
 * derruba o acesso de ninguem na hora.
 *
 * Tudo numa transacao so: ou o pagamento, a fatura, o credito, a
 * auditoria e o evento mudam juntos, ou nada muda.
 */

export class PagamentoNaoEncontradoParaCancelamentoError extends ErroDeDominio {
  constructor() {
    super('PAYMENT_NOT_FOUND', 404, 'pagamento nao encontrado');
  }
}

export interface PagamentoCancelado {
  readonly paymentId: string;
  readonly invoiceId: string;
  /**
   * A fatura voltou a aberta? `false` quando havia OUTRO pagamento confirmado
   * na mesma competencia: ele passa a quita-la e a fatura continua paga.
   */
  readonly faturaReaberta: boolean;
}

interface PagamentoLido {
  readonly id: string;
  readonly invoiceId: string;
  readonly method: string;
  readonly status: string;
  readonly amountMinor: number;
  readonly paidAt: Date | null;
  readonly receivedVia: string | null;
  readonly batchId: string | null;
  readonly invoice: {
    readonly subscriptionId: string;
    readonly billingPeriod: Date;
    readonly totalMinor: number;
  };
}

@Injectable()
export class CancelarPagamentoManualUseCase {
  constructor(private readonly db: PrismaService) {}

  async executar(
    contexto: TenantContext,
    entrada: { paymentId: string; reason: string; agora: Date },
    correlationId: string,
  ): Promise<PagamentoCancelado> {
    const pagamento = await this.db.payment.findFirst({
      where: { id: entrada.paymentId, tenantId: contexto.tenantId },
      select: {
        id: true,
        invoiceId: true,
        method: true,
        status: true,
        amountMinor: true,
        paidAt: true,
        receivedVia: true,
        batchId: true,
        invoice: { select: { subscriptionId: true, billingPeriod: true, totalMinor: true } },
      },
    });

    if (!pagamento) {
      throw new PagamentoNaoEncontradoParaCancelamentoError();
    }

    validarCancelamento(pagamento, entrada.reason);

    const motivo = entrada.reason.trim();

    return this.db.$transaction(async (tx) => {
      /**
       * TRAVA A FATURA antes de contar os pagamentos dela. Sem isto, dois
       * cancelamentos simultaneos de pagamentos DIFERENTES da mesma competencia
       * (os dois de uma fatura com dinheiro + PIX) contariam "2 confirmados"
       * cada um e cancelariam os dois, deixando a fatura `PAID` sem dinheiro
       * nenhum. Com a trava o segundo espera e conta 1.
       */
      await tx.$queryRaw`
        SELECT id FROM invoices
        WHERE id = ${pagamento.invoiceId}::uuid AND tenant_id = ${contexto.tenantId}::uuid
        FOR UPDATE
      `;

      const confirmados = await tx.payment.findMany({
        where: { tenantId: contexto.tenantId, invoiceId: pagamento.invoiceId, status: 'CONFIRMED' },
        select: { id: true },
      });

      // Regra de QUANDO (decisao do PI, 05/10/2026): adiantado, ou 2+
      // pagamentos na mesma competencia; mes que ja passou nunca.
      const efeito = decidirCancelamento({
        competencia: pagamento.invoice.billingPeriod,
        agora: entrada.agora,
        confirmadosNaFatura: confirmados.length,
      });

      const creditosDoCancelado = await tx.accountCredit.findMany({
        where: { tenantId: contexto.tenantId, originPaymentId: pagamento.id },
        select: { status: true, amountMinor: true },
      });

      if (creditosDoCancelado.some((credito) => credito.status === 'APPLIED')) {
        throw new CreditoJaAplicadoError();
      }

      /**
       * TRANSICAO CONDICIONADA, nao `update`: dois cancelamentos simultaneos
       * (duplo clique) leem ambos `CONFIRMED`; o filtro de status garante que
       * so UM move o pagamento. O outro recebe `count = 0` e a transacao
       * inteira desfaz -- mesma tecnica de `registrarPagamentoManual`.
       */
      const cancelado = await tx.payment.updateMany({
        where: { id: pagamento.id, tenantId: contexto.tenantId, method: 'MANUAL', status: 'CONFIRMED' },
        data: {
          status: 'CANCELLED',
          cancelledAt: entrada.agora,
          cancelledByUserId: contexto.actorId,
          cancelReason: motivo,
        },
      });

      if (cancelado.count !== 1) {
        throw new PagamentoNaoCancelavelError('pagamento ja foi cancelado ou alterado por outra operacao');
      }

      await tx.accountCredit.updateMany({
        where: { tenantId: contexto.tenantId, originPaymentId: pagamento.id, status: 'AVAILABLE' },
        data: { status: 'EXPIRED' },
      });

      const faturaReaberta = efeito === 'REABRE_FATURA';

      if (faturaReaberta) {
        const reaberta = await tx.invoice.updateMany({
          where: { id: pagamento.invoiceId, tenantId: contexto.tenantId, status: 'PAID' },
          data: { status: 'OPEN', paidAt: null, coverageEndsAt: null, version: { increment: 1 } },
        });

        if (reaberta.count !== 1) {
          throw new TransicaoDeInvoiceConcorrenteError(pagamento.invoiceId);
        }
      } else {
        await this.passarQuitacaoAoOutroPagamento(
          tx,
          contexto,
          pagamento,
          confirmados.map((confirmado) => confirmado.id).filter((id) => id !== pagamento.id),
          creditosDoCancelado.reduce((soma, credito) => soma + credito.amountMinor, 0),
        );
      }

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'PaymentCancelled',
          aggregateType: 'Payment',
          aggregateId: pagamento.id,
          payload: {
            invoiceId: pagamento.invoiceId,
            amountMinor: pagamento.amountMinor,
            faturaReaberta,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'billing.payment.cancelled',
          target: 'Payment',
          targetId: pagamento.id,
          correlationId,
          metadata: {
            invoiceId: pagamento.invoiceId,
            amountMinor: pagamento.amountMinor,
            reason: motivo,
            receivedVia: pagamento.receivedVia,
            faturaReaberta,
          },
        },
      });

      return { paymentId: pagamento.id, invoiceId: pagamento.invoiceId, faturaReaberta };
    });
  }

  /**
   * A fatura tinha 2+ pagamentos e um saiu: ela continua `PAID`, mas o
   * dinheiro que a quita pode mudar de dono (`creditoAConsumir`).
   *
   * Se o cancelado era o que QUITOU, o outro -- que tinha virado credito
   * inteiro quando chegou com a fatura ja paga -- passa a quitar: o credito
   * dele e consumido no valor da fatura. Sem isso o aluno ficaria com a fatura
   * paga E o mesmo dinheiro de credito.
   */
  private async passarQuitacaoAoOutroPagamento(
    tx: Prisma.TransactionClient,
    contexto: TenantContext,
    pagamento: PagamentoLido,
    outrosConfirmados: readonly string[],
    creditoDoCanceladoMinor: number,
  ): Promise<void> {
    const paga = await tx.invoice.count({
      where: { id: pagamento.invoiceId, tenantId: contexto.tenantId, status: 'PAID' },
    });

    if (paga !== 1) {
      throw new TransicaoDeInvoiceConcorrenteError(pagamento.invoiceId);
    }

    const creditosDosOutros = await tx.accountCredit.findMany({
      where: {
        tenantId: contexto.tenantId,
        originPaymentId: { in: [...outrosConfirmados] },
        status: 'AVAILABLE',
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, amountMinor: true },
    });

    const consumo = creditoAConsumir({
      totalDaFaturaMinor: pagamento.invoice.totalMinor,
      pagoNoCanceladoMinor: pagamento.amountMinor,
      creditoDoCanceladoMinor,
      creditosDisponiveisDosOutros: creditosDosOutros,
    });

    if (consumo === null) {
      return;
    }

    await tx.accountCredit.update({
      where: { id: consumo.creditId },
      data:
        consumo.restanteMinor === 0
          ? { status: 'EXPIRED' }
          : { amountMinor: consumo.restanteMinor },
    });
  }
}
