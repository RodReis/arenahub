import { Inject, Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import {
  estornoEhTotal,
  podeTransicionarEstorno,
  suspendeAcessoAgora,
  type StatusDoEstorno,
} from './domain/estorno.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider/payment-provider.port.js';

/**
 * Fecha um estorno que ficou pendente no provedor. F16, `M2-FR-017`
 * ("solicitar estorno/refund e **acompanhar estado até conclusão**").
 *
 * POR QUE ESTE ARQUIVO EXISTE, e o defeito que ele conserta: o estorno dos dois
 * provedores homologados e ASSINCRONO -- `refundPayment` devolve `PENDING` e a
 * confirmacao vem depois. A primeira versao desta fatia gravava `PROCESSING` e
 * anotava "quem fecha e o webhook", mas o webhook so entendia evento de
 * PAGAMENTO: nao havia caminho nenhum que levasse `PROCESSING → CONFIRMED`.
 *
 * E o estorno preso nao era so um registro feio. O indice parcial
 * `refunds_payment_id_em_voo_key` -- que existe para impedir dois estornos
 * simultaneos -- passaria a bloquear PARA SEMPRE qualquer novo estorno daquele
 * pagamento, inclusive o parcial legitimo. A guarda contra devolver em dobro
 * viraria a guarda contra devolver.
 *
 * O teste nao pegava porque o duble sempre confirmava na hora: a suite inteira
 * passava sem tocar no ramo assincrono. `simularEstornoAssincrono()` existe por
 * isso.
 *
 * CONSULTA ATIVA, e nao so webhook, pelo mesmo motivo do INV-083 no pagamento:
 * um desfecho que so pode chegar por webhook fica preso quando o webhook nao
 * chega -- e nao chegar e o caso que a operacao precisa conseguir destravar.
 */

export class EstornoNaoEncontradoError extends ErroDeDominio {
  constructor() {
    super('REFUND_NOT_FOUND', 404, 'estorno nao encontrado');
  }
}

export interface DesfechoDoEstorno {
  readonly refundId: string;
  readonly status: StatusDoEstorno;
  /** `false` quando o provedor ainda nao decidiu -- nada mudou. */
  readonly mudou: boolean;
  readonly acessoSuspenso: boolean;
}

@Injectable()
export class ObservarEstornoUseCase {
  constructor(
    private readonly db: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provedor: PaymentProvider,
  ) {}

  async executar(
    contexto: TenantContext,
    entrada: { refundId: string; agora: Date },
    correlationId: string,
  ): Promise<DesfechoDoEstorno> {
    const refund = await this.db.refund.findFirst({
      where: { id: entrada.refundId, tenantId: contexto.tenantId },
      select: {
        id: true,
        status: true,
        amountMinor: true,
        paymentId: true,
        invoiceId: true,
        externalRefundId: true,
        payment: { select: { amountMinor: true } },
      },
    });

    if (!refund) {
      throw new EstornoNaoEncontradoError();
    }

    /**
     * Terminal nao se reobserva. Consultar de novo o que ja fechou custaria uma
     * chamada ao provedor para confirmar o que ja sabemos -- e devolver o
     * estado atual e a resposta certa, nao um erro: reprocessar tem de ser
     * seguro (INV-086).
     */
    if (refund.status === 'CONFIRMED' || refund.status === 'FAILED') {
      return {
        refundId: refund.id,
        status: refund.status,
        mudou: false,
        acessoSuspenso: false,
      };
    }

    if (!refund.externalRefundId) {
      /**
       * `REQUESTED` sem id externo: a chamada ao provedor nao chegou a
       * completar. Nao ha o que consultar, e inventar um desfecho seria
       * decidir sobre dinheiro por conta propria.
       */
      return { refundId: refund.id, status: refund.status, mudou: false, acessoSuspenso: false };
    }

    const noProvedor = await this.provedor.getRefundStatus(refund.externalRefundId);

    if (noProvedor.status === 'PENDING') {
      return { refundId: refund.id, status: refund.status, mudou: false, acessoSuspenso: false };
    }

    const novoStatus: StatusDoEstorno =
      noProvedor.status === 'CONFIRMED' ? 'CONFIRMED' : 'FAILED';

    if (!podeTransicionarEstorno(refund.status, novoStatus)) {
      return { refundId: refund.id, status: refund.status, mudou: false, acessoSuspenso: false };
    }

    if (novoStatus === 'FAILED') {
      await this.db.refund.update({
        where: { id: refund.id },
        data: { status: 'FAILED', failureCode: 'PROVIDER_REJECTED', settledAt: entrada.agora },
      });

      /**
       * FALHA LIBERA O INDICE PARCIAL, e essa e a metade que importa: o
       * pagamento volta a aceitar estorno. Deixar em `PROCESSING` transformaria
       * uma recusa transitoria do provedor em bloqueio permanente.
       */
      return { refundId: refund.id, status: 'FAILED', mudou: true, acessoSuspenso: false };
    }

    const configuracao = await this.db.billingSettings.findUnique({
      where: { tenantId: contexto.tenantId },
      select: { refundAccessPolicy: true },
    });

    const politica = configuracao?.refundAccessPolicy ?? 'KEEP_UNTIL_PERIOD_END';
    const suspender = suspendeAcessoAgora(politica);

    /**
     * Soma os OUTROS estornos confirmados. O proprio ainda esta `PROCESSING`,
     * entao nao entra -- e some-lo aqui e depois confirma-lo contaria o mesmo
     * dinheiro duas vezes na hora de decidir se a invoice fecha.
     */
    const confirmados = await this.db.refund.aggregate({
      where: {
        tenantId: contexto.tenantId,
        paymentId: refund.paymentId,
        status: 'CONFIRMED',
        id: { not: refund.id },
      },
      _sum: { amountMinor: true },
    });

    const total = estornoEhTotal(
      refund.payment.amountMinor,
      confirmados._sum.amountMinor ?? 0,
      refund.amountMinor,
    );

    await this.db.$transaction(async (tx) => {
      /**
       * `updateMany` com o status no filtro, e nao `update` por id: o webhook e
       * a consulta ativa podem chegar juntos ao mesmo estorno, e o segundo a
       * escrever aplicaria a politica de acesso duas vezes. Aqui o segundo
       * simplesmente nao encontra o que atualizar.
       */
      const atualizados = await tx.refund.updateMany({
        where: { id: refund.id, tenantId: contexto.tenantId, status: refund.status },
        data: {
          status: 'CONFIRMED',
          appliedAccessPolicy: politica,
          settledAt: entrada.agora,
        },
      });

      if (atualizados.count === 0) {
        return;
      }

      if (total) {
        await tx.payment.update({ where: { id: refund.paymentId }, data: { status: 'REFUNDED' } });
        await tx.invoice.update({
          where: { id: refund.invoiceId },
          data: { status: 'REFUNDED', version: { increment: 1 } },
        });
      }

      if (suspender) {
        const invoice = await tx.invoice.findFirst({
          where: { id: refund.invoiceId, tenantId: contexto.tenantId },
          select: { subscriptionId: true },
        });

        if (invoice) {
          await tx.entitlement.updateMany({
            where: {
              subscriptionId: invoice.subscriptionId,
              tenantId: contexto.tenantId,
              status: 'ACTIVE',
            },
            data: { status: 'SUSPENDED', suspendedAt: entrada.agora, version: { increment: 1 } },
          });
        }
      }

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'PaymentRefunded',
          aggregateType: 'Payment',
          aggregateId: refund.paymentId,
          payload: {
            refundId: refund.id,
            invoiceId: refund.invoiceId,
            amountMinor: refund.amountMinor,
            total,
            accessPolicy: politica,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          // SYSTEM e nao USER: quem fechou foi a observacao do provedor, nao
          // uma pessoa. Atribuir a quem pediu o estorno diria que ela agiu num
          // instante em que nao agiu.
          actorType: 'SYSTEM',
          action: 'billing.refund.confirmed',
          target: 'Payment',
          targetId: refund.paymentId,
          correlationId,
          metadata: {
            refundId: refund.id,
            amountMinor: refund.amountMinor,
            accessPolicy: politica,
            acessoSuspenso: suspender,
            total,
          },
        },
      });
    });

    return {
      refundId: refund.id,
      status: 'CONFIRMED',
      mudou: true,
      acessoSuspenso: suspender,
    };
  }
}
