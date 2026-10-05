import { Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import { ConfiguracaoFinanceiraAusenteError } from './billing.repository.js';
import { instanteDeBloqueio, proximoVencimento } from './domain/ciclo-de-cobranca.js';
import {
  CreditoJaAplicadoError,
  PagamentoNaoCancelavelError,
  deveRestaurarVencimento,
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
 * Tudo numa transacao so: ou o pagamento, a fatura, o credito, o vencimento, a
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
  /** A fatura seguinte voltou ao vencimento padrao do ciclo? */
  readonly vencimentoRestaurado: boolean;
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
  readonly invoice: { readonly subscriptionId: string; readonly billingPeriod: Date };
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
        invoice: { select: { subscriptionId: true, billingPeriod: true } },
      },
    });

    if (!pagamento) {
      throw new PagamentoNaoEncontradoParaCancelamentoError();
    }

    validarCancelamento(pagamento, entrada.reason);

    const motivo = entrada.reason.trim();

    return this.db.$transaction(async (tx) => {
      const creditoUsado = await tx.accountCredit.findFirst({
        where: { tenantId: contexto.tenantId, originPaymentId: pagamento.id, status: 'APPLIED' },
        select: { id: true },
      });

      if (creditoUsado) {
        throw new CreditoJaAplicadoError();
      }

      /**
       * OUTRO pagamento confirmado cobrindo a mesma fatura -- tipicamente um
       * PIX pago por fora cujo webhook chegou com a fatura ja `PAID` (ele grava
       * o pagamento e manda o valor para credito). Reabrir a fatura aqui faria
       * o aluno "dever" um mes que pagou de verdade, e o credito do PIX ficaria
       * disponivel sem ninguem para abate-lo. Quem decide esse caso e o gerente.
       */
      const outroConfirmado = await tx.payment.findFirst({
        where: {
          tenantId: contexto.tenantId,
          invoiceId: pagamento.invoiceId,
          status: 'CONFIRMED',
          id: { not: pagamento.id },
        },
        select: { id: true },
      });

      if (outroConfirmado) {
        throw new PagamentoNaoCancelavelError(
          'esta cobranca tem outro pagamento confirmado; cancelar este a reabriria indevidamente',
        );
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

      const reaberta = await tx.invoice.updateMany({
        where: { id: pagamento.invoiceId, tenantId: contexto.tenantId, status: 'PAID' },
        data: { status: 'OPEN', paidAt: null, version: { increment: 1 } },
      });

      if (reaberta.count !== 1) {
        throw new TransicaoDeInvoiceConcorrenteError(pagamento.invoiceId);
      }

      await tx.accountCredit.updateMany({
        where: { tenantId: contexto.tenantId, originPaymentId: pagamento.id, status: 'AVAILABLE' },
        data: { status: 'EXPIRED' },
      });

      const vencimentoRestaurado = await this.restaurarVencimentoDaSeguinte(tx, contexto, pagamento);

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'PaymentCancelled',
          aggregateType: 'Payment',
          aggregateId: pagamento.id,
          payload: {
            invoiceId: pagamento.invoiceId,
            amountMinor: pagamento.amountMinor,
            vencimentoRestaurado,
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
            invoiceVencimentoRestaurado: vencimentoRestaurado,
          },
        },
      });

      return { paymentId: pagamento.id, invoiceId: pagamento.invoiceId, vencimentoRestaurado };
    });
  }

  /**
   * Devolve a fatura seguinte ao vencimento do ciclo SE o lote que a
   * empurrou foi desfeito por inteiro e a data ainda e a que ele gravou
   * (`deveRestaurarVencimento`). So pagamento em lote ancora vencimento --
   * o avulso (`batchId` nulo) nunca mexeu em fatura nenhuma.
   *
   * A "seguinte" e a primeira `OPEN`/`OVERDUE` com competencia POSTERIOR a
   * maior do lote: as do proprio lote acabaram de reabrir e nao contam.
   */
  private async restaurarVencimentoDaSeguinte(
    tx: Prisma.TransactionClient,
    contexto: TenantContext,
    pagamento: PagamentoLido,
  ): Promise<boolean> {
    if (pagamento.batchId === null || pagamento.paidAt === null) {
      return false;
    }

    // Le DENTRO da transacao: este pagamento ja aparece como `CANCELLED`.
    const lote = await tx.payment.findMany({
      where: { tenantId: contexto.tenantId, batchId: pagamento.batchId },
      select: { status: true, invoice: { select: { billingPeriod: true } } },
    });

    const ultimaCompetencia = lote.reduce(
      (maior, p) => (p.invoice.billingPeriod.getTime() > maior.getTime() ? p.invoice.billingPeriod : maior),
      pagamento.invoice.billingPeriod,
    );

    const seguinte = await tx.invoice.findFirst({
      where: {
        tenantId: contexto.tenantId,
        subscriptionId: pagamento.invoice.subscriptionId,
        billingPeriod: { gt: ultimaCompetencia },
        status: { in: ['OPEN', 'OVERDUE'] },
      },
      orderBy: { billingPeriod: 'asc' },
      select: { id: true, dueAt: true, billingPeriod: true },
    });

    if (!seguinte) {
      return false;
    }

    const restaurar = deveRestaurarVencimento({
      dueAtAtual: seguinte.dueAt,
      paidAt: pagamento.paidAt,
      tamanhoDoLote: lote.length,
      confirmadosRestantesNoLote: lote.filter((p) => p.status === 'CONFIRMED').length,
    });

    if (!restaurar) {
      return false;
    }

    const configuracao = await tx.billingSettings.findUnique({
      where: { tenantId: contexto.tenantId },
      select: { dueDay: true, graceDays: true },
    });

    if (!configuracao) {
      throw new ConfiguracaoFinanceiraAusenteError();
    }

    const dueAt = proximoVencimento(seguinte.billingPeriod, configuracao.dueDay);

    await tx.invoice.update({
      where: { id: seguinte.id },
      data: {
        dueAt,
        blockAt: instanteDeBloqueio(dueAt, configuracao.graceDays),
        version: { increment: 1 },
      },
    });

    return true;
  }
}
