import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { podeTransicionar } from './domain/invoice.js';
import { ProviderAccountResolver } from './provider/provider-account.resolver.js';
import {
  ErroDoProvedor,
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './provider/payment-provider.port.js';

/**
 * Cria a cobranca PIX de uma invoice aberta. `MVP-02` 7, Slice 2.2.
 *
 * ORDEM DELIBERADA: a tentativa e gravada ANTES da chamada ao provedor, e
 * atualizada depois. Se a API morrer entre a chamada e a resposta, sobra uma
 * tentativa em `PROCESSING` -- rastreavel. Chamar primeiro e gravar depois
 * deixaria uma cobranca viva no provedor sem NENHUM registro nosso: dinheiro
 * do aluno entrando contra uma invoice que nao sabe que foi cobrada.
 *
 * O CASO DE USO NAO CONFIRMA PAGAMENTO. Criar cobranca e so isso: o PIX
 * nasce `PENDING` e so vira `CONFIRMED` pelo webhook (INV-076) ou pela
 * consulta ativa. Regra de arquitetura 1 -- pagamento nao controla acesso
 * diretamente, a cadeia inteira passa por invoice e entitlement.
 */

/**
 * Validade da cobranca PIX.
 *
 * O PRD nao fixa o prazo (`MVP-02` 6 cita "PIX cobranca e expiracao" sem
 * numero). 30 minutos e decisao tecnica reversivel, registrada no PR: e
 * folgado para quem abre o app do banco na recepcao e curto o bastante para
 * o valor nao ficar preso quando o aluno desiste. Vira configuracao do
 * tenant quando alguem pedir -- nao antes.
 */
export const MINUTOS_DE_VALIDADE_DO_PIX = 30;

export class InvoiceNaoCobravelError extends ErroDeDominio {
  constructor(status: string) {
    super(
      'INVOICE_NOT_CHARGEABLE',
      409,
      `Invoice em ${status} nao aceita cobranca; apenas invoice aberta ou vencida`,
    );
  }
}

export class InvoiceNaoEncontradaParaCobrancaError extends ErroDeDominio {
  constructor() {
    super('INVOICE_NOT_FOUND', 404, 'Invoice nao encontrada');
  }
}

export class CobrancaRecusadaPeloProvedorError extends ErroDeDominio {
  constructor(codigo: string, recuperavel: boolean) {
    super(
      'PIX_CHARGE_REJECTED',
      recuperavel ? 503 : 422,
      `Provedor recusou a cobranca PIX (${codigo})`,
    );
  }
}

export interface CobrancaPixCriada {
  paymentAttemptId: string;
  externalPaymentId: string;
  copiaECola: string;
  qrCodeDataUri: string;
  expiresAt: Date;
  amountMinor: number;
  currency: string;
}

@Injectable()
export class CriarCobrancaPixUseCase {
  constructor(
    private readonly db: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provedor: PaymentProvider,
    private readonly contas: ProviderAccountResolver,
  ) {}

  /**
   * `agora` entra por parametro (`CLAUDE.md`): a expiracao da cobranca e
   * verificavel em teste sem relogio falso.
   */
  async executar(
    contexto: TenantContext,
    entrada: { invoiceId: string; agora: Date },
    correlationId: string,
  ): Promise<CobrancaPixCriada> {
    const invoice = await this.db.invoice.findFirst({
      where: { id: entrada.invoiceId, tenantId: contexto.tenantId },
    });

    if (!invoice) {
      throw new InvoiceNaoEncontradaParaCobrancaError();
    }

    /**
     * Reusa a maquina de estado do dominio em vez de reimplementar a lista
     * de status cobraveis: se `PAID` deixar de aceitar transicao um dia,
     * este caminho acompanha sozinho.
     */
    if (!podeTransicionar(invoice.status, 'PAID')) {
      throw new InvoiceNaoCobravelError(invoice.status);
    }

    /**
     * PEDE A CONTA DE PIX, nao "uma conta ativa qualquer".
     *
     * Ate 19/08/2026 esta linha era `findFirst({ tenantId, active: true })`,
     * o que bastava com um provedor so. Com Sicoob e Getnet cadastrados no
     * mesmo tenant (ADR-032), ela devolveria a conta de CARTAO metade das
     * vezes -- dependendo da ordem de insercao, sem erro e sem log.
     */
    const conta = await this.contas.resolver(contexto, 'PIX');

    /**
     * REUSO DA TENTATIVA PENDENTE: pedir o PIX de novo enquanto o anterior
     * ainda vale devolve a MESMA cobranca. Sem isso, recarregar a tela
     * geraria um QR novo a cada clique e o aluno pagaria o que ja tinha
     * expirado na tela anterior.
     */
    const pendente = await this.db.paymentAttempt.findFirst({
      where: {
        tenantId: contexto.tenantId,
        invoiceId: invoice.id,
        method: 'PIX',
        status: 'PROCESSING',
        externalPaymentId: { not: null },
      },
      orderBy: { requestedAt: 'desc' },
    });

    if (pendente?.externalPaymentId) {
      const noProvedor = await this.provedor.getPaymentStatus(pendente.externalPaymentId);

      if (noProvedor.status === 'PENDING' && noProvedor.occurredAt > entrada.agora) {
        const recriada = await this.provedor.createPix({
          externalAccountId: conta.externalAccountId,
          amountMinor: invoice.totalMinor,
          currency: invoice.currency,
          idempotencyKey: pendente.idempotencyKey,
          expiresAt: noProvedor.occurredAt,
          descricao: `Invoice ${invoice.number}`,
        });

        return {
          paymentAttemptId: pendente.id,
          externalPaymentId: recriada.externalPaymentId,
          copiaECola: recriada.copiaECola,
          qrCodeDataUri: recriada.qrCodeDataUri,
          expiresAt: recriada.expiresAt,
          amountMinor: invoice.totalMinor,
          currency: invoice.currency,
        };
      }
    }

    const expiresAt = new Date(
      entrada.agora.getTime() + MINUTOS_DE_VALIDADE_DO_PIX * 60 * 1000,
    );

    /**
     * Chave de idempotencia enviada ao provedor (`MVP-02` 11).
     *
     * Inclui o instante porque uma invoice pode ser cobrada de novo depois
     * que a cobranca anterior expirou -- chave so com o id da invoice faria
     * o provedor devolver eternamente a primeira cobranca, ja vencida.
     */
    const idempotencyKey = `${invoice.id}:pix:${entrada.agora.toISOString()}`;

    const tentativa = await this.db.paymentAttempt.create({
      data: {
        tenantId: contexto.tenantId,
        invoiceId: invoice.id,
        method: 'PIX',
        status: 'PROCESSING',
        idempotencyKey,
        providerAccountId: conta.externalAccountId,
      },
    });

    let cobranca;

    try {
      cobranca = await this.provedor.createPix({
        externalAccountId: conta.externalAccountId,
        amountMinor: invoice.totalMinor,
        currency: invoice.currency,
        idempotencyKey,
        expiresAt,
        descricao: `Invoice ${invoice.number}`,
      });
    } catch (erro) {
      const { codigo, recuperavel } = this.classificar(erro);

      /**
       * A falha e gravada, nao engolida: tentativa e o registro do QUE FOI
       * TENTADO (ADR-027), e sucesso posterior nao apaga falha anterior.
       */
      await this.db.paymentAttempt.update({
        where: { id: tentativa.id },
        data: {
          status: 'FAILED',
          failureCode: codigo,
          failureIsPermanent: !recuperavel,
          settledAt: entrada.agora,
        },
      });

      throw new CobrancaRecusadaPeloProvedorError(codigo, recuperavel);
    }

    await this.db.$transaction(async (tx) => {
      await tx.paymentAttempt.update({
        where: { id: tentativa.id },
        data: { externalPaymentId: cobranca.externalPaymentId },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'billing.payment.pix.created',
          target: 'PaymentAttempt',
          targetId: tentativa.id,
          correlationId,
          metadata: {
            invoiceId: invoice.id,
            amountMinor: invoice.totalMinor,
            externalPaymentId: cobranca.externalPaymentId,
            expiresAt: cobranca.expiresAt.toISOString(),
          } satisfies Prisma.InputJsonObject,
        },
      });
    });

    return {
      paymentAttemptId: tentativa.id,
      externalPaymentId: cobranca.externalPaymentId,
      copiaECola: cobranca.copiaECola,
      qrCodeDataUri: cobranca.qrCodeDataUri,
      expiresAt: cobranca.expiresAt,
      amountMinor: invoice.totalMinor,
      currency: invoice.currency,
    };
  }

  /** Erro do provedor ja vem classificado; qualquer outro e tratado como transitorio. */
  private classificar(erro: unknown): { codigo: string; recuperavel: boolean } {
    if (erro instanceof ErroDoProvedor) {
      return { codigo: erro.codigo, recuperavel: erro.recuperavel };
    }

    return { codigo: 'PROVIDER_UNAVAILABLE', recuperavel: true };
  }
}
