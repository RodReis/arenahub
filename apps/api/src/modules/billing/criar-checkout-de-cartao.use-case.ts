import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { faltaParaCartao, type DadoFaltante } from './domain/dados-de-cobranca.js';
import { podeTransicionar } from './domain/invoice.js';
import { ProviderAccountResolver } from './provider/provider-account.resolver.js';
import {
  ErroDoProvedor,
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './provider/payment-provider.port.js';

/**
 * Cria o checkout HOSPEDADO de cartao de uma invoice aberta. `SPEC-053` 9.
 *
 * ORDEM DELIBERADA, herdada de `criar-cobranca-pix.use-case.ts`: a tentativa
 * e gravada ANTES da chamada ao provedor, e atualizada depois. Se a API
 * morrer entre a chamada e a resposta, sobra uma tentativa rastreavel.
 * Chamar primeiro e gravar depois deixaria uma cobranca viva no provedor sem
 * NENHUM registro nosso.
 *
 * O ALUNO DIGITA O CARTAO NO PROPRIO CELULAR, na pagina do provedor -- nunca
 * no nosso backend (INV-098). O caso de uso so cria o link e o QR; a
 * confirmacao chega depois, por webhook ou consulta ativa, igual ao PIX.
 */

/**
 * Validade do checkout. Mesmo raciocinio do PIX (`criar-cobranca-pix.use-case.ts`):
 * folgado para o aluno abrir o link no proprio celular, curto o bastante
 * para o valor nao ficar preso quando ele desiste.
 */
export const MINUTOS_DE_VALIDADE_DO_CHECKOUT = 30;

export class InvoiceNaoCobravelParaCheckoutError extends ErroDeDominio {
  constructor(status: string) {
    super(
      'INVOICE_NOT_CHARGEABLE',
      409,
      `Invoice em ${status} nao aceita cobranca; apenas invoice aberta ou vencida`,
    );
  }
}

export class InvoiceNaoEncontradaParaCheckoutError extends ErroDeDominio {
  constructor() {
    super('INVOICE_NOT_FOUND', 404, 'Invoice nao encontrada');
  }
}

/**
 * Cadastro incompleto para pagar no cartao. 422 e nao 409: nao ha conflito de
 * estado, ha dado que falta -- e a tela precisa saber QUAL para dizer a frase
 * certa (SPEC-053 §9.1).
 */
export class DadosDeCobrancaIncompletosError extends ErroDeDominio {
  constructor(readonly faltando: readonly DadoFaltante[]) {
    super(
      'STUDENT_BILLING_DATA_INCOMPLETE',
      422,
      `Cadastro do aluno incompleto para pagamento no cartao: ${faltando.join(', ')}`,
    );
  }
}

export class CheckoutJaEmAndamentoError extends ErroDeDominio {
  constructor() {
    /**
     * 409: nao ha nada de errado com o pedido -- ja existe um checkout desta
     * invoice em voo. Devolver 500 mandaria a recepcao clicar de novo, que e
     * exatamente o que o indice parcial existe para impedir.
     */
    super(
      'CARD_CHECKOUT_ALREADY_IN_FLIGHT',
      409,
      'Ja existe um checkout de cartao desta invoice em andamento; aguarde o desfecho',
    );
  }
}

export class CheckoutRecusadoPeloProvedorError extends ErroDeDominio {
  constructor(codigo: string, recuperavel: boolean) {
    super(
      'CARD_CHECKOUT_REJECTED',
      recuperavel ? 503 : 422,
      `Provedor recusou a criacao do checkout de cartao (${codigo})`,
    );
  }
}

export interface CheckoutCriado {
  paymentAttemptId: string;
  externalPaymentId: string;
  checkoutUrl: string;
  qrCodeDataUri: string;
  expiresAt: Date;
  amountMinor: number;
  currency: string;
}

@Injectable()
export class CriarCheckoutDeCartaoUseCase {
  constructor(
    private readonly db: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provedor: PaymentProvider,
    private readonly contas: ProviderAccountResolver,
  ) {}

  /**
   * `agora` entra por parametro (`CLAUDE.md`): a expiracao do checkout e
   * verificavel em teste sem relogio falso.
   */
  async executar(
    contexto: TenantContext,
    entrada: { invoiceId: string; agora: Date },
    correlationId: string,
  ): Promise<CheckoutCriado> {
    const invoice = await this.db.invoice.findFirst({
      where: { id: entrada.invoiceId, tenantId: contexto.tenantId },
      include: {
        student: {
          include: {
            addresses: true,
            contacts: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new InvoiceNaoEncontradaParaCheckoutError();
    }

    /**
     * Reusa a maquina de estado do dominio, mesma razao do PIX: se `PAID`
     * deixar de aceitar transicao um dia, este caminho acompanha sozinho.
     */
    if (!podeTransicionar(invoice.status, 'PAID')) {
      throw new InvoiceNaoCobravelParaCheckoutError(invoice.status);
    }

    /**
     * RECUSA ANTES DE RESOLVER CONTA E ANTES DE CHAMAR O PROVEDOR.
     *
     * A ordem importa: a Getnet bloquearia por antifraude e devolveria
     * recusa generica, que a recepcao leria como "o cartao nao passou" --
     * quando o conserto e preencher o cadastro. Ver SPEC-053 §9.1.
     */
    const faltando = faltaParaCartao({
      cpf: invoice.student.cpf,
      temEndereco: invoice.student.addresses.length > 0,
    });

    if (faltando.length > 0) {
      throw new DadosDeCobrancaIncompletosError(faltando);
    }

    // `'CARD'`, nao `'getnet'`. Nenhum caso de uso menciona a marca (F14).
    const conta = await this.contas.resolver(contexto, 'CARD');

    const expiresAt = new Date(
      entrada.agora.getTime() + MINUTOS_DE_VALIDADE_DO_CHECKOUT * 60 * 1000,
    );

    const idempotencyKey = `${invoice.id}:checkout:${entrada.agora.toISOString()}`;

    let tentativa: { id: string };

    try {
      tentativa = await this.db.paymentAttempt.create({
        data: {
          tenantId: contexto.tenantId,
          invoiceId: invoice.id,
          method: 'CARD',
          status: 'CREATED',
          idempotencyKey,
          providerAccountId: conta.externalAccountId,
        },
        select: { id: true },
      });
    } catch (erro) {
      /**
       * P2002 = violacao de unicidade. O indice parcial
       * `payment_attempts_um_checkout_em_voo` cobre `CREATED`,
       * `REQUIRES_ACTION` e `PROCESSING`: outra requisicao ja colocou um
       * checkout desta invoice em voo. NAO checamos `if (jaExiste)` antes --
       * essa checagem perde a corrida por construcao, que e justamente o
       * defeito que o indice existe para impedir.
       */
      if (erroDeUnicidade(erro)) {
        throw new CheckoutJaEmAndamentoError();
      }

      throw erro;
    }

    // Nao anulavel aqui: `faltaParaCartao` ja recusou quem nao tem endereco.
    const enderecoDeCobranca = invoice.student.addresses[0]!;
    const contatoEmail = invoice.student.contacts.find((c) => c.type === 'EMAIL')?.value ?? null;
    const contatoTelefone =
      invoice.student.contacts.find((c) => c.type === 'PHONE' || c.type === 'WHATSAPP')?.value ??
      null;

    let checkout;

    try {
      checkout = await this.provedor.createHostedCheckout({
        externalAccountId: conta.externalAccountId,
        amountMinor: invoice.totalMinor,
        currency: invoice.currency,
        idempotencyKey,
        expiresAt,
        descricao: `Invoice ${invoice.number}`,
        customer: {
          nome: invoice.student.fullName,
          email: contatoEmail,
          telefone: contatoTelefone,
          // Nao anulavel aqui: `faltaParaCartao` ja recusou quem nao tem CPF.
          cpf: invoice.student.cpf!,
          endereco: {
            logradouro: enderecoDeCobranca.street,
            numero: enderecoDeCobranca.number ?? '',
            bairro: enderecoDeCobranca.district ?? '',
            cidade: enderecoDeCobranca.city,
            uf: enderecoDeCobranca.state,
            cep: enderecoDeCobranca.postalCode,
          },
        },
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

      throw new CheckoutRecusadoPeloProvedorError(codigo, recuperavel);
    }

    await this.db.$transaction(async (tx) => {
      await tx.paymentAttempt.update({
        where: { id: tentativa.id },
        data: { externalPaymentId: checkout.externalPaymentId },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'billing.payment.card_checkout.created',
          target: 'PaymentAttempt',
          targetId: tentativa.id,
          correlationId,
          metadata: {
            invoiceId: invoice.id,
            amountMinor: invoice.totalMinor,
            externalPaymentId: checkout.externalPaymentId,
            expiresAt: checkout.expiresAt.toISOString(),
          } satisfies Prisma.InputJsonObject,
        },
      });
    });

    return {
      paymentAttemptId: tentativa.id,
      externalPaymentId: checkout.externalPaymentId,
      checkoutUrl: checkout.checkoutUrl,
      qrCodeDataUri: checkout.qrCodeDataUri,
      expiresAt: checkout.expiresAt,
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

/**
 * Violacao de unicidade do Prisma (P2002).
 *
 * Checagem estrutural, nao `instanceof PrismaClientKnownRequestError`: o
 * `code` e contrato publico e estavel, e importar a classe do Prisma no caso
 * de uso amarraria a regra de negocio ao ORM.
 *
 * Prisma 7 com `adapter-pg`: o nome do constraint NAO vem em `meta.target`
 * -- so em texto livre da mensagem. Por isso a deteccao para no `code`, sem
 * tentar identificar QUAL indice, igual ao padrao ja usado em
 * `cobrar-assinatura-no-cartao.use-case.ts`.
 */
function erroDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002';
}
