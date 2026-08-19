import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  decidirSobreEvento,
  type MotivoDeDescarte,
  type StatusDoPagamento,
} from './domain/evento-do-provedor.js';
import { aplicarPagamento, podeTransicionar } from './domain/invoice.js';
import {
  ErroDoProvedor,
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type RawWebhook,
} from './provider/payment-provider.port.js';

/**
 * Processa webhook do provedor de pagamento. `MVP-02` 7, Slice 2.2.
 *
 * ACEITE DA FATIA: "PIX sandbox e homologacao atualizam o acesso UMA UNICA
 * VEZ mesmo com webhook repetido".
 *
 * A CADEIA COMPLETA, e a ordem dela (regra de arquitetura no 1):
 *
 *   webhook -> pagamento CONFIRMED -> invoice PAID -> assinatura ACTIVE
 *   -> entitlement ACTIVE
 *
 * A catraca NUNCA consulta invoice nem assinatura -- ela le entitlement. Por
 * isso o ultimo elo importa tanto quanto o primeiro: parar em "invoice paga"
 * deixaria o aluno pagando e batendo na porta fechada.
 *
 * TRES GUARDAS, EM ORDEM, e cada uma existe por um motivo diferente:
 *
 *   1. INV-077 -- assinatura verificada ANTES de qualquer processamento.
 *      Se falha, nada aconteceu: nem inbox, nem log com payload.
 *   2. INV-078 -- o tenant vem da CONTA do provedor, nunca do payload.
 *   3. INV-076 -- unicidade `(conta, evento)` no banco. Nao e o
 *      `if (jaProcessei)`: esse perde a corrida entre duas entregas
 *      simultaneas do mesmo evento; a constraint nao perde.
 *
 * TUDO NUMA TRANSACAO SO, com o outbox dentro (regra de arquitetura no 5):
 * gravar o inbox e falhar na ativacao produziria um evento marcado como
 * processado que nao processou nada -- e o provedor nunca reenviaria.
 */

export class ContaDoProvedorDesconhecidaError extends ErroDeDominio {
  constructor() {
    super('PROVIDER_ACCOUNT_UNKNOWN', 404, 'Conta do provedor nao cadastrada');
  }
}

export class WebhookNaoAutenticadoError extends ErroDeDominio {
  constructor() {
    /**
     * 401 sem detalhe: dizer ao chamador SE a conta existe, se a assinatura
     * expirou ou se o corpo esta malformado entrega o mapa a quem tenta
     * forjar. Provedor legitimo assina certo e nunca ve esta resposta.
     */
    super('WEBHOOK_UNAUTHENTICATED', 401, 'Webhook nao autenticado');
  }
}

export type ResultadoDoWebhook =
  | { aplicado: true; providerEventId: string; novoStatus: StatusDoPagamento }
  | { aplicado: false; providerEventId: string; motivo: MotivoDeDescarte };

@Injectable()
export class ProcessarWebhookDePagamentoUseCase {
  constructor(
    private readonly db: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provedor: PaymentProvider,
  ) {}

  /**
   * `agora` entra por parametro (`CLAUDE.md`): a data de pagamento gravada
   * na invoice precisa ser verificavel em teste sem relogio falso.
   */
  async executar(entrada: RawWebhook, agora: Date): Promise<ResultadoDoWebhook> {
    // 1. INV-077 -- verificacao ANTES de tudo. Nada e gravado se falhar.
    let evento;

    try {
      evento = await this.provedor.verifyAndParseWebhook(entrada);
    } catch (erro) {
      if (erro instanceof ErroDoProvedor) {
        throw new WebhookNaoAutenticadoError();
      }

      throw erro;
    }

    // 2. INV-078 -- a conta resolve o tenant; o payload nao tem voz nisso.
    const conta = await this.db.providerAccount.findUnique({
      where: {
        provider_externalAccountId: {
          provider: entrada.provider,
          externalAccountId: evento.externalAccountId,
        },
      },
    });

    if (!conta || !conta.active) {
      throw new ContaDoProvedorDesconhecidaError();
    }

    const tenantId = conta.tenantId;

    return this.db.$transaction(async (tx) => {
      /**
       * 3. INV-076 -- a constraint E a idempotencia.
       *
       * `createMany` com `skipDuplicates` em vez de `findFirst` seguido de
       * `create`: entre a leitura e a escrita cabe a segunda entrega do
       * mesmo evento, e o resultado seria duas ativacoes. Aqui o banco
       * decide, e quem perder a corrida recebe `count: 0`.
       */
      const inserido = await tx.providerEvent.createMany({
        data: [
          {
            tenantId,
            providerAccountId: conta.id,
            externalEventId: evento.externalEventId,
            eventType: evento.tipo,
            externalPaymentId: evento.externalPaymentId,
            payload: evento.payload as Prisma.InputJsonValue,
            occurredAt: evento.occurredAt,
          },
        ],
        skipDuplicates: true,
      });

      const registro = await tx.providerEvent.findUniqueOrThrow({
        where: {
          providerAccountId_externalEventId: {
            providerAccountId: conta.id,
            externalEventId: evento.externalEventId,
          },
        },
      });

      const jaRecebido = inserido.count === 0;

      const alvo = evento.externalPaymentId
        ? await this.localizarPagamento(tx, tenantId, evento.externalPaymentId)
        : null;

      const decisao = decidirSobreEvento(
        {
          externalEventId: evento.externalEventId,
          tipo: evento.tipo,
          occurredAt: evento.occurredAt,
        },
        alvo?.estado ?? { status: 'PENDING', ultimoEventoAplicadoEm: null },
        jaRecebido,
      );

      if (!decisao.aplicar) {
        /**
         * Descarte tambem e registrado -- so nao muda estado. Sem
         * `skippedReason`, "por que este evento nao fez nada?" nao teria
         * resposta seis meses depois.
         *
         * Duplicata NAO reescreve o registro anterior: a linha ja tem o
         * desfecho do primeiro processamento, e sobrescrever apagaria o
         * unico lugar onde ele consta.
         */
        if (!jaRecebido) {
          await tx.providerEvent.update({
            where: { id: registro.id },
            data: { skippedReason: decisao.motivo, processedAt: agora },
          });
        }

        return { aplicado: false, providerEventId: registro.id, motivo: decisao.motivo };
      }

      if (!alvo) {
        await tx.providerEvent.update({
          where: { id: registro.id },
          data: { skippedReason: 'TIPO_DESCONHECIDO', processedAt: agora },
        });

        return {
          aplicado: false,
          providerEventId: registro.id,
          motivo: 'TIPO_DESCONHECIDO' as const,
        };
      }

      await this.aplicar(tx, {
        tenantId,
        registroId: registro.id,
        attemptId: alvo.attemptId,
        invoiceId: alvo.invoiceId,
        externalPaymentId: evento.externalPaymentId ?? '',
        providerAccountId: conta.externalAccountId,
        novoStatus: decisao.novoStatus,
        occurredAt: evento.occurredAt,
        agora,
      });

      return {
        aplicado: true,
        providerEventId: registro.id,
        novoStatus: decisao.novoStatus,
      };
    });
  }

  /**
   * Reprocessa um evento JA GUARDADO e ainda nao aplicado. F16, `M2-FR-020`.
   *
   * NAO REVERIFICA A ASSINATURA, e nao e descuido: a verificacao aconteceu
   * quando o evento chegou (INV-077), e refaze-la exigiria reter o corpo bruto
   * e os headers indefinidamente -- payload cru guardado a mais e superficie
   * de vazamento, e o `MVP-02` §15 pede retencao minima. O que se reprocessa e
   * um registro que ja passou pela porta.
   *
   * SEGURO POR CONSTRUCAO (INV-086): passa pela MESMA `decidirSobreEvento` do
   * caminho normal. Evento ja aplicado devolve `false` sem tocar em nada; o
   * `processedAt: null` no filtro e conveniencia de leitura, nao a garantia.
   *
   * DEVOLVE `false` EM VEZ DE ESTOURAR quando o evento nao muda estado: a
   * resolucao de divergencia precisa distinguir "reprocessei e nada mudou" de
   * "falhou", e as duas coisas sao resultados legitimos.
   */
  async reprocessarEventoGuardado(tenantId: string, providerEventId: string): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const registro = await tx.providerEvent.findFirst({
        where: { id: providerEventId, tenantId },
        select: {
          id: true,
          eventType: true,
          externalPaymentId: true,
          occurredAt: true,
          processedAt: true,
          account: { select: { externalAccountId: true } },
        },
      });

      if (!registro || registro.processedAt !== null) {
        return false;
      }

      const alvo = registro.externalPaymentId
        ? await this.localizarPagamento(tx, tenantId, registro.externalPaymentId)
        : null;

      const decisao = decidirSobreEvento(
        {
          externalEventId: providerEventId,
          tipo: registro.eventType,
          occurredAt: registro.occurredAt,
        },
        alvo?.estado ?? { status: 'PENDING', ultimoEventoAplicadoEm: null },
        // `false`: o evento ja esta guardado por definicao, e passar `true`
        // aqui o descartaria como duplicata -- que e justamente o que o
        // reprocessamento existe para nao fazer.
        false,
      );

      const agora = registro.occurredAt;

      if (!decisao.aplicar || !alvo) {
        await tx.providerEvent.update({
          where: { id: registro.id },
          data: {
            skippedReason: decisao.aplicar ? 'TIPO_DESCONHECIDO' : decisao.motivo,
            processedAt: agora,
          },
        });

        return false;
      }

      await this.aplicar(tx, {
        tenantId,
        registroId: registro.id,
        attemptId: alvo.attemptId,
        invoiceId: alvo.invoiceId,
        externalPaymentId: registro.externalPaymentId ?? '',
        providerAccountId: registro.account.externalAccountId,
        novoStatus: decisao.novoStatus,
        occurredAt: registro.occurredAt,
        agora,
      });

      return true;
    });
  }

  /**
   * Acha a tentativa que originou o pagamento e monta o estado atual.
   *
   * A busca e pela TENTATIVA, nao pelo pagamento: no PIX o pagamento so
   * nasce quando a confirmacao chega, e o `external_payment_id` ja existe na
   * tentativa desde a criacao da cobranca.
   */
  private async localizarPagamento(
    tx: Prisma.TransactionClient,
    tenantId: string,
    externalPaymentId: string,
  ): Promise<{
    attemptId: string;
    invoiceId: string;
    estado: { status: StatusDoPagamento; ultimoEventoAplicadoEm: Date | null };
  } | null> {
    const tentativa = await tx.paymentAttempt.findFirst({
      where: { tenantId, externalPaymentId },
      include: { payment: true },
    });

    if (!tentativa) return null;

    /**
     * `ultimoEventoAplicadoEm` vem do ultimo evento que REALMENTE mudou
     * estado (`processedAt` preenchido e sem `skippedReason`). Usar o
     * ultimo recebido faria um evento descartado bloquear o proximo
     * legitimo.
     */
    const ultimoAplicado = await tx.providerEvent.findFirst({
      where: { tenantId, externalPaymentId, processedAt: { not: null }, skippedReason: null },
      orderBy: { occurredAt: 'desc' },
    });

    return {
      attemptId: tentativa.id,
      invoiceId: tentativa.invoiceId,
      estado: {
        status: tentativa.payment?.status ?? 'PENDING',
        ultimoEventoAplicadoEm: ultimoAplicado?.occurredAt ?? null,
      },
    };
  }

  /** A cadeia inteira, na mesma transacao. */
  private async aplicar(
    tx: Prisma.TransactionClient,
    dados: {
      tenantId: string;
      registroId: string;
      attemptId: string;
      invoiceId: string;
      externalPaymentId: string;
      providerAccountId: string;
      novoStatus: StatusDoPagamento;
      occurredAt: Date;
      agora: Date;
    },
  ): Promise<void> {
    await tx.providerEvent.update({
      where: { id: dados.registroId },
      data: { processedAt: dados.agora },
    });

    if (dados.novoStatus !== 'CONFIRMED') {
      await tx.paymentAttempt.update({
        where: { id: dados.attemptId },
        data: {
          status: 'FAILED',
          failureCode: `PROVIDER_${dados.novoStatus}`,
          /**
           * Falha vinda de webhook e tratada como PERMANENTE: o provedor ja
           * fechou a cobranca. Repetir a mesma cobranca nao a ressuscita --
           * o caminho e uma cobranca nova.
           */
          failureIsPermanent: true,
          settledAt: dados.agora,
        },
      });

      return;
    }

    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: dados.invoiceId } });

    /**
     * Invoice ja paga por outro caminho (dinheiro na recepcao, por exemplo)
     * enquanto o PIX estava aberto. O pagamento e registrado -- o dinheiro
     * entrou -- mas a invoice nao muda: INV-069, `PAID` nao volta atras.
     *
     * O excedente vira credito do aluno pelo mesmo caminho do pagamento
     * manual (ADR-027, resposta 4).
     */
    const invoiceAindaCobravel = podeTransicionar(invoice.status, 'PAID');
    const resultado = invoiceAindaCobravel
      ? aplicarPagamento(invoice.totalMinor, invoice.totalMinor)
      : { status: invoice.status, creditoMinor: invoice.totalMinor };

    const pagamento = await tx.payment.create({
      data: {
        tenantId: dados.tenantId,
        invoiceId: invoice.id,
        amountMinor: invoice.totalMinor,
        currency: invoice.currency,
        method: 'PIX',
        status: 'CONFIRMED',
        paidAt: dados.occurredAt,
        attemptId: dados.attemptId,
        providerAccountId: dados.providerAccountId,
        externalPaymentId: dados.externalPaymentId,
      },
    });

    await tx.paymentAttempt.update({
      where: { id: dados.attemptId },
      data: { status: 'SUCCEEDED', settledAt: dados.agora },
    });

    if (!invoiceAindaCobravel) {
      await tx.accountCredit.create({
        data: {
          tenantId: dados.tenantId,
          studentId: invoice.studentId,
          originPaymentId: pagamento.id,
          amountMinor: resultado.creditoMinor,
          currency: invoice.currency,
        },
      });

      await this.auditar(tx, dados, pagamento.id, 'billing.payment.pix.credited');
      return;
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: 'PAID', paidAt: dados.occurredAt, version: { increment: 1 } },
    });

    await this.ativarDireitoDeAcesso(tx, dados, invoice.subscriptionId);

    await tx.outboxEvent.create({
      data: {
        tenantId: dados.tenantId,
        eventType: 'InvoicePaid',
        aggregateType: 'Invoice',
        aggregateId: invoice.id,
        payload: {
          paymentId: pagamento.id,
          method: 'PIX',
          externalPaymentId: dados.externalPaymentId,
        },
      },
    });

    await this.auditar(tx, dados, pagamento.id, 'billing.payment.pix.confirmed');
  }

  /**
   * Ultimo elo da cadeia: assinatura ativa, entitlement ativo.
   *
   * SO PROMOVE O QUE ESTA ESPERANDO. Assinatura ja `ACTIVE` nao e tocada, e
   * entitlement `REVOKED` NAO ressuscita por pagamento -- revogacao tem
   * motivo proprio (inelegibilidade, LGPD), e dinheiro nao a desfaz.
   *
   * Nao CRIA entitlement: quem cria e a matricula (F7/F10), com o snapshot
   * de politica do plano. Criar um aqui exigiria montar snapshot dentro do
   * financeiro -- modulo lendo regra de outro, que e o que a regra de
   * arquitetura no 9 proibe.
   */
  private async ativarDireitoDeAcesso(
    tx: Prisma.TransactionClient,
    dados: { tenantId: string; agora: Date },
    subscriptionId: string,
  ): Promise<void> {
    await tx.subscription.updateMany({
      where: {
        id: subscriptionId,
        tenantId: dados.tenantId,
        status: { in: ['PENDING', 'PAST_DUE'] },
      },
      data: { status: 'ACTIVE', version: { increment: 1 } },
    });

    await tx.entitlement.updateMany({
      where: {
        subscriptionId,
        tenantId: dados.tenantId,
        status: { in: ['SCHEDULED', 'SUSPENDED'] },
      },
      data: { status: 'ACTIVE', suspendedAt: null, version: { increment: 1 } },
    });
  }

  private async auditar(
    tx: Prisma.TransactionClient,
    dados: {
      tenantId: string;
      invoiceId: string;
      externalPaymentId: string;
      registroId: string;
    },
    paymentId: string,
    acao: string,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: dados.tenantId,
        /**
         * `SYSTEM`: nenhum operador clicou. Atribuir a um usuario tornaria a
         * trilha do controle detectivo (ADR-027) mentirosa -- e ela e o que
         * sobrou depois que a dupla permissao saiu do MVP 2.
         */
        actorType: 'SYSTEM',
        action: acao,
        target: 'Payment',
        targetId: paymentId,
        /**
         * O id do evento do provedor como correlacao: e o que liga a linha
         * de auditoria ao webhook exato que a causou.
         */
        correlationId: dados.registroId,
        metadata: {
          invoiceId: dados.invoiceId,
          externalPaymentId: dados.externalPaymentId,
        } satisfies Prisma.InputJsonObject,
      },
    });
  }
}
