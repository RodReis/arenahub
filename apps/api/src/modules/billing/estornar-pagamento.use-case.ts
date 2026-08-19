import { Inject, Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import {
  estornoEhTotal,
  suspendeAcessoAgora,
  validarPedidoDeEstorno,
  type MetodoDoPagamento,
  type PoliticaDeAcessoNoEstorno,
} from './domain/estorno.js';
import {
  ErroDoProvedor,
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './provider/payment-provider.port.js';

/**
 * Estorno de pagamento. F16, `MVP-02` §7 (Slice 2.5), `M2-FR-017`.
 *
 * A CADEIA, e o que ela deliberadamente NAO faz:
 *
 *   pedido → valida → grava REQUESTED → chama provedor → confirma → invoice
 *
 * A invoice vira `REFUNDED`, nunca volta a `OPEN` (INV-069): reabrir diria
 * que o aluno nunca pagou, e ele pagou. E o acesso segue a politica do tenant
 * a partir da confirmacao, nunca para tras (INV-094, `M2-BR-009`).
 *
 * ORDEM QUE NAO PODE INVERTER (INV-084): o `Refund` e gravado ANTES da
 * chamada ao provedor. Se a rede cair depois do provedor devolver o dinheiro
 * e antes de gravarmos, o dinheiro sai sem registro nosso -- e a conciliacao
 * acusaria um `MISSING_INTERNAL` que ninguem sabe explicar.
 */

export class PagamentoNaoEncontradoParaEstornoError extends ErroDeDominio {
  constructor() {
    super('PAYMENT_NOT_FOUND', 404, 'pagamento nao encontrado');
  }
}

export class EstornoJaEmAndamentoError extends ErroDeDominio {
  constructor() {
    /**
     * 409 e nao 500: nao ha nada de errado com o pedido -- ja existe um
     * estorno deste pagamento em voo. Um 500 mandaria a recepcao clicar de
     * novo, que e exatamente o que nao pode acontecer quando o assunto e
     * devolver dinheiro.
     */
    super(
      'BILLING_REFUND_ALREADY_IN_FLIGHT',
      409,
      'Ja existe um estorno deste pagamento em andamento; aguarde o desfecho',
    );
  }
}

export class ContaDoPagamentoAusenteError extends ErroDeDominio {
  constructor() {
    super(
      'PROVIDER_ACCOUNT_MISSING',
      409,
      'a conta que recebeu este pagamento nao esta mais cadastrada',
    );
  }
}

export interface EstornoRegistrado {
  readonly refundId: string;
  readonly status: string;
  readonly amountMinor: number;
  readonly currency: string;
  /** Politica aplicada, para a tela dizer ao operador o que aconteceu. */
  readonly politicaDeAcesso: PoliticaDeAcessoNoEstorno;
  /** O acesso do aluno foi suspenso agora? */
  readonly acessoSuspenso: boolean;
}

@Injectable()
export class EstornarPagamentoUseCase {
  constructor(
    private readonly db: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provedor: PaymentProvider,
  ) {}

  /**
   * `agora` entra por parametro (`CLAUDE.md`): o instante da confirmacao e o
   * marco a partir do qual a politica de acesso vale, e isso tem de ser
   * verificavel sem relogio falso.
   */
  async executar(
    contexto: TenantContext,
    entrada: { paymentId: string; amountMinor: number; reason: string; agora: Date },
    correlationId: string,
  ): Promise<EstornoRegistrado> {
    const pagamento = await this.db.payment.findFirst({
      where: { id: entrada.paymentId, tenantId: contexto.tenantId },
      select: {
        id: true,
        invoiceId: true,
        status: true,
        method: true,
        amountMinor: true,
        currency: true,
        providerAccountId: true,
        externalPaymentId: true,
      },
    });

    if (!pagamento) {
      throw new PagamentoNaoEncontradoParaEstornoError();
    }

    const configuracao = await this.db.billingSettings.findUnique({
      where: { tenantId: contexto.tenantId },
      select: { refundAccessPolicy: true, refundLimitMinor: true },
    });

    /**
     * Soma so o que CONFIRMOU. Estorno `FAILED` nao consumiu dinheiro nenhum,
     * e conta-lo bloquearia a retentativa legitima de uma falha transitoria.
     */
    const confirmados = await this.db.refund.aggregate({
      where: { tenantId: contexto.tenantId, paymentId: pagamento.id, status: 'CONFIRMED' },
      _sum: { amountMinor: true },
    });
    const jaEstornadoMinor = confirmados._sum.amountMinor ?? 0;

    validarPedidoDeEstorno(
      {
        status: pagamento.status,
        method: pagamento.method as MetodoDoPagamento,
        amountMinor: pagamento.amountMinor,
        currency: pagamento.currency,
      },
      {
        amountMinor: entrada.amountMinor,
        reason: entrada.reason,
        limiteMinor: configuracao?.refundLimitMinor ?? null,
        jaEstornadoMinor,
      },
    );

    if (!pagamento.externalPaymentId || !pagamento.providerAccountId) {
      throw new ContaDoPagamentoAusenteError();
    }

    /**
     * `Payment.providerAccountId` guarda o id EXTERNO (string do provedor),
     * nao o UUID interno -- e por isso que a busca aqui e por
     * `externalAccountId`, e nao por chave primaria.
     *
     * O nome da coluna sugere o contrario e ja me enganou uma vez. Ele esta
     * certo assim: e o par `(providerAccountId, externalPaymentId)` que da a
     * idempotencia do evento externo, e ele precisa casar com o que o provedor
     * manda -- um UUID nosso nunca casaria.
     */
    const conta = await this.db.providerAccount.findFirst({
      where: { tenantId: contexto.tenantId, externalAccountId: pagamento.providerAccountId },
      select: { externalAccountId: true },
    });

    if (!conta) {
      throw new ContaDoPagamentoAusenteError();
    }

    /**
     * Chave de idempotencia enviada ao provedor (`MVP-02` §11).
     *
     * DERIVADA DO VALOR E DO QUE JA FOI ESTORNADO, nunca de uma CONTAGEM: foi
     * a contagem que cobrou o aluno em dobro na F14, porque ela muda entre a
     * leitura e a escrita. Aqui o par (quanto ja saiu, quanto sai agora)
     * identifica o pedido de forma estavel -- duas requisicoes concorrentes
     * montam a MESMA chave, e o banco recusa a segunda.
     *
     * A chave sozinha ainda nao basta: quem fecha a janela e o indice parcial
     * `refunds_payment_id_em_voo_key`.
     */
    const idempotencyKey = `refund:${pagamento.id}:${jaEstornadoMinor}:${entrada.amountMinor}`;

    let refund: { id: string };

    try {
      refund = await this.db.refund.create({
        data: {
          tenantId: contexto.tenantId,
          paymentId: pagamento.id,
          invoiceId: pagamento.invoiceId,
          amountMinor: entrada.amountMinor,
          currency: pagamento.currency,
          status: 'REQUESTED',
          reason: entrada.reason,
          requestedByUserId: contexto.actorId,
          idempotencyKey,
        },
        select: { id: true },
      });
    } catch (erro) {
      if (erroDeUnicidade(erro)) {
        throw new EstornoJaEmAndamentoError();
      }

      throw erro;
    }

    let resultado: { externalRefundId: string; status: string };

    try {
      resultado = await this.provedor.refundPayment({
        externalPaymentId: pagamento.externalPaymentId,
        amountMinor: entrada.amountMinor,
        idempotencyKey,
      });
    } catch (erro) {
      if (erro instanceof ErroDoProvedor) {
        /**
         * A RECUSA E GRAVADA, nao so lancada -- mesmo criterio da F14. Sem
         * isso o estorno ficaria `REQUESTED` para sempre, travando o indice
         * parcial e impedindo qualquer nova tentativa deste pagamento.
         */
        await this.db.refund.update({
          where: { id: refund.id },
          data: { status: 'FAILED', failureCode: erro.codigo, settledAt: entrada.agora },
        });
      }

      throw erro;
    }

    if (resultado.status !== 'CONFIRMED') {
      /**
       * Provedor assincrono: o dinheiro ainda nao voltou. Fica `PROCESSING`,
       * e quem fecha e o webhook. NAO se aplica politica de acesso aqui --
       * suspender antes da confirmacao puniria o aluno por um estorno que
       * ainda pode falhar.
       */
      await this.db.refund.update({
        where: { id: refund.id },
        data: { status: 'PROCESSING', externalRefundId: resultado.externalRefundId },
      });

      return {
        refundId: refund.id,
        status: 'PROCESSING',
        amountMinor: entrada.amountMinor,
        currency: pagamento.currency,
        politicaDeAcesso: configuracao?.refundAccessPolicy ?? 'KEEP_UNTIL_PERIOD_END',
        acessoSuspenso: false,
      };
    }

    const politica = configuracao?.refundAccessPolicy ?? 'KEEP_UNTIL_PERIOD_END';
    const total = estornoEhTotal(pagamento.amountMinor, jaEstornadoMinor, entrada.amountMinor);
    const suspender = suspendeAcessoAgora(politica);

    await this.db.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: 'CONFIRMED',
          externalRefundId: resultado.externalRefundId,
          appliedAccessPolicy: politica,
          settledAt: entrada.agora,
        },
      });

      /**
       * SO O ESTORNO TOTAL move a invoice. Parcial deixa `PAID`, porque parte
       * do dinheiro continua tendo entrado -- dizer `REFUNDED` sobre uma
       * invoice que reteve 60% mentiria para a conciliacao, que soma pelos
       * estados.
       */
      if (total) {
        await tx.payment.update({
          where: { id: pagamento.id },
          data: { status: 'REFUNDED' },
        });

        await tx.invoice.update({
          where: { id: pagamento.invoiceId },
          data: { status: 'REFUNDED', version: { increment: 1 } },
        });
      }

      if (suspender) {
        await this.suspenderAcesso(tx, contexto, pagamento.invoiceId, entrada.agora);
      }

      /**
       * Evento de dominio na MESMA transacao (INV-084, regra de arquitetura
       * n 5). `PaymentRefunded` esta declarado em `MVP-02` §14.
       */
      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'PaymentRefunded',
          aggregateType: 'Payment',
          aggregateId: pagamento.id,
          payload: {
            refundId: refund.id,
            invoiceId: pagamento.invoiceId,
            amountMinor: entrada.amountMinor,
            currency: pagamento.currency,
            total,
            accessPolicy: politica,
          },
        },
      });

      /**
       * Auditoria obrigatoria -- INV-126 lista estorno nominalmente.
       *
       * A razao e o step-up vao em `metadata` porque `AuditLog` nao tem campo
       * proprio para nenhum dos dois; a razao tambem fica em `Refund.reason`,
       * que e onde ela e consultavel. Decisao registrada no PR: adicionar
       * colunas a `audit_logs` mexeria numa tabela que todos os modulos ja
       * entregues usam, e o ganho nao paga o risco nesta fatia.
       */
      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'billing.payment.refunded',
          target: 'Payment',
          targetId: pagamento.id,
          correlationId,
          metadata: {
            refundId: refund.id,
            invoiceId: pagamento.invoiceId,
            amountMinor: entrada.amountMinor,
            reason: entrada.reason,
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
      amountMinor: entrada.amountMinor,
      currency: pagamento.currency,
      politicaDeAcesso: politica,
      acessoSuspenso: suspender,
    };
  }

  /**
   * Suspende o entitlement da assinatura desta invoice.
   *
   * `updateMany` com filtro de status, e nao `update`: so o que esta ATIVO e
   * suspenso. Um entitlement ja `REVOKED` nao volta a `SUSPENDED` -- mesmo
   * criterio que a F13 usa para nao ressuscitar acesso revogado.
   *
   * NAO TOCA EM HISTORICO DE ACESSO. Entrada que ja aconteceu aconteceu
   * (INV-094): reescreve-la seria inventar que alguem nao entrou.
   */
  private async suspenderAcesso(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    contexto: TenantContext,
    invoiceId: string,
    agora: Date,
  ): Promise<void> {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, tenantId: contexto.tenantId },
      select: { subscriptionId: true },
    });

    if (!invoice) {
      return;
    }

    await tx.entitlement.updateMany({
      where: {
        subscriptionId: invoice.subscriptionId,
        tenantId: contexto.tenantId,
        status: 'ACTIVE',
      },
      data: { status: 'SUSPENDED', suspendedAt: agora, version: { increment: 1 } },
    });
  }
}

/**
 * Violacao de unicidade do Prisma (P2002).
 *
 * Checagem estrutural em vez de `instanceof PrismaClientKnownRequestError`:
 * importar a classe de erro do Prisma no caso de uso amarraria a regra de
 * negocio ao ORM, e o `code` e contrato publico e estavel. Mesma funcao que a
 * F14 usa -- duplicada de proposito, porque extrai-la para um utilitario
 * compartilhado criaria acoplamento entre casos de uso que nao se conhecem.
 */
function erroDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002';
}
