import { Inject, Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { podeTransicionar } from './domain/invoice.js';
import {
  OFFSETS_DE_RETRY_PADRAO,
  proximaTentativa,
  type MotivoDeParar,
} from './domain/retry-de-cobranca.js';
import {
  ErroDoProvedor,
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './provider/payment-provider.port.js';
import { ProviderAccountResolver } from './provider/provider-account.resolver.js';

/**
 * Cobra uma invoice no cartao tokenizado do aluno. `MVP-02` 7, Slice 2.3:
 * "cobranca recorrente" e "falha de cobranca e proxima tentativa".
 *
 * NAO CONFIRMA PAGAMENTO -- mesma regra da cobranca PIX (F13). A tentativa
 * nasce `PROCESSING` e vira `SUCCEEDED` pelo webhook (INV-076) ou pela
 * consulta ativa. Confirmar aqui criaria um SEGUNDO caminho de escrita para
 * "invoice paga", que e o que a idempotencia existe para impedir.
 *
 * ORDEM DELIBERADA, herdada da F13: a tentativa e gravada ANTES da chamada ao
 * provedor. Se o processo morrer no meio, sobra uma tentativa `PROCESSING` --
 * rastreavel. Chamar primeiro e gravar depois deixaria uma cobranca viva no
 * provedor sem registro nenhum do nosso lado.
 */

export class InvoiceNaoEncontradaParaCartaoError extends ErroDeDominio {
  constructor() {
    super('INVOICE_NOT_FOUND', 404, 'Invoice nao encontrada');
  }
}

export class InvoiceNaoCobravelNoCartaoError extends ErroDeDominio {
  constructor(status: string) {
    super(
      'INVOICE_NOT_CHARGEABLE',
      409,
      `Invoice em ${status} nao aceita cobranca; apenas invoice aberta ou vencida`,
    );
  }
}

export class AlunoSemMetodoDePagamentoError extends ErroDeDominio {
  constructor() {
    super(
      'PAYMENT_METHOD_MISSING',
      409,
      'Aluno sem cartao ativo; cadastre um metodo de pagamento antes de cobrar',
    );
  }
}

export class CobrancaEsgotadaError extends ErroDeDominio {
  constructor(readonly motivo: MotivoDeParar) {
    super(
      motivo === 'RECUSA_PERMANENTE' ? 'CARD_DECLINED_PERMANENTLY' : 'CHARGE_ATTEMPTS_EXHAUSTED',
      409,
      motivo === 'RECUSA_PERMANENTE'
        ? 'O cartao foi recusado em definitivo; peca outro cartao ao aluno'
        : 'As tentativas de cobranca desta invoice se esgotaram',
    );
  }
}

export class CobrancaJaEmAndamentoError extends ErroDeDominio {
  constructor() {
    /**
     * 409: nao ha nada de errado com o pedido -- ja existe uma cobranca desta
     * invoice em voo. Devolver 500 mandaria a recepcao tentar de novo, que e
     * exatamente o que nao pode acontecer.
     */
    super(
      'CARD_CHARGE_ALREADY_IN_FLIGHT',
      409,
      'Ja existe uma cobranca desta invoice em andamento; aguarde o desfecho',
    );
  }
}

export interface CobrancaNoCartaoCriada {
  readonly paymentAttemptId: string;
  readonly externalSubscriptionId: string;
  readonly amountMinor: number;
  readonly currency: string;
}

@Injectable()
export class CobrarAssinaturaNoCartaoUseCase {
  constructor(
    private readonly db: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provedor: PaymentProvider,
    private readonly contas: ProviderAccountResolver,
  ) {}

  /**
   * `agora` entra por parametro (`CLAUDE.md`): decidir se a tentativa de hoje
   * ja pode acontecer depende do relogio, e isso tem de ser verificavel em
   * teste sem relogio falso.
   */
  async executar(
    contexto: TenantContext,
    entrada: { invoiceId: string; agora: Date },
  ): Promise<CobrancaNoCartaoCriada> {
    const invoice = await this.db.invoice.findFirst({
      where: { id: entrada.invoiceId, tenantId: contexto.tenantId },
    });

    if (!invoice) {
      throw new InvoiceNaoEncontradaParaCartaoError();
    }

    /**
     * Reusa a maquina de estado do dominio em vez de listar status cobraveis
     * -- se `PAID` deixar de aceitar transicao um dia, este caminho acompanha
     * sozinho. Mesmo criterio da cobranca PIX.
     */
    if (!podeTransicionar(invoice.status, 'PAID')) {
      throw new InvoiceNaoCobravelNoCartaoError(invoice.status);
    }

    const metodo = await this.db.paymentMethod.findFirst({
      where: {
        tenantId: contexto.tenantId,
        studentId: invoice.studentId,
        status: 'ACTIVE',
        isDefault: true,
      },
      select: { id: true, externalTokenId: true },
    });

    if (!metodo) {
      throw new AlunoSemMetodoDePagamentoError();
    }

    /**
     * TENTATIVAS DE CARTAO, nao de PIX. Uma invoice paga em duas formas
     * (PIX falho + cartao) e o caso que o ADR-027 modelou: contar as duas
     * juntas faria uma tentativa de PIX consumir a cota do cartao.
     */
    const tentativasFeitas = await this.db.paymentAttempt.count({
      where: { tenantId: contexto.tenantId, invoiceId: invoice.id, method: 'CARD' },
    });

    const ultimaFalha = await this.db.paymentAttempt.findFirst({
      where: {
        tenantId: contexto.tenantId,
        invoiceId: invoice.id,
        method: 'CARD',
        status: 'FAILED',
      },
      orderBy: { requestedAt: 'desc' },
      select: { failureIsPermanent: true },
    });

    const configuracao = await this.db.billingSettings.findUnique({
      where: { tenantId: contexto.tenantId },
      select: { retryOffsetDays: true },
    });

    const decisao = proximaTentativa(
      {
        tentativasFeitas,
        /**
         * `?? undefined` e nao `?? false`: "nunca falhou" e "falhou de forma
         * recuperavel" sao estados diferentes, e a funcao pura distingue os
         * dois. Colapsar em `false` funcionaria hoje por coincidencia.
         */
        ultimaFalhaEPermanente: ultimaFalha?.failureIsPermanent ?? undefined,
      },
      { offsetsEmDias: configuracao?.retryOffsetDays ?? OFFSETS_DE_RETRY_PADRAO },
      invoice.dueAt,
    );

    if (!decisao.deveTentar) {
      throw new CobrancaEsgotadaError(decisao.motivo);
    }

    const conta = await this.contas.resolver(contexto, 'CARD');

    /**
     * Chave de idempotencia enviada ao provedor (`MVP-02` 11). Inclui o
     * INDICE da tentativa: sem ele, a segunda tentativa da mesma invoice
     * reusaria a chave da primeira e o provedor devolveria a cobranca
     * recusada em vez de tentar de novo.
     *
     * A CHAVE SOZINHA NAO BASTA, e isso foi medido: ela deriva de uma
     * CONTAGEM, e contagem muda entre a leitura e a escrita -- duas
     * requisicoes concorrentes leem 0 e 1, montam `:0` e `:1`, e a constraint
     * de idempotencia nunca dispara. Quem fecha a janela e o indice parcial
     * `payment_attempts_uma_cobranca_de_cartao_em_voo`, no banco: um
     * `if (jaExiste)` aqui perderia a mesma corrida.
     */
    const idempotencyKey = `card:${invoice.id}:${tentativasFeitas}`;

    let tentativa: { id: string };

    try {
      tentativa = await this.db.paymentAttempt.create({
        data: {
          tenantId: contexto.tenantId,
          invoiceId: invoice.id,
          method: 'CARD',
          status: 'PROCESSING',
          idempotencyKey,
          providerAccountId: conta.id,
        },
        select: { id: true },
      });
    } catch (erro) {
      /**
       * P2002 = violacao de unicidade. Aqui ela significa uma coisa so: outra
       * requisicao ja colocou uma cobranca desta invoice em voo. Traduzir
       * para erro de dominio e o que impede um 500 -- e um 500 faria a
       * recepcao clicar de novo.
       */
      if (erroDeUnicidade(erro)) {
        throw new CobrancaJaEmAndamentoError();
      }

      throw erro;
    }

    try {
      const assinatura = await this.provedor.createTokenizedSubscription({
        externalAccountId: conta.externalAccountId,
        cardToken: metodo.externalTokenId,
        amountMinor: invoice.totalMinor,
        currency: invoice.currency,
        idempotencyKey,
      });

      await this.db.paymentAttempt.update({
        where: { id: tentativa.id },
        data: { externalPaymentId: assinatura.externalSubscriptionId },
      });

      return {
        paymentAttemptId: tentativa.id,
        externalSubscriptionId: assinatura.externalSubscriptionId,
        amountMinor: invoice.totalMinor,
        currency: invoice.currency,
      };
    } catch (erro) {
      if (erro instanceof ErroDoProvedor) {
        /**
         * A RECUSA E GRAVADA, nao so lancada. `failureIsPermanent` vem de
         * `recuperavel` do provedor e e o que faz a proxima chamada parar em
         * vez de repetir -- perde-lo aqui transformaria cartao cancelado em
         * tres cobrancas recusadas, taxa e marca contra a loja.
         */
        await this.db.paymentAttempt.update({
          where: { id: tentativa.id },
          data: {
            status: 'FAILED',
            failureCode: erro.codigo,
            failureIsPermanent: !erro.recuperavel,
          },
        });
      }

      throw erro;
    }
  }
}

/**
 * Violacao de unicidade do Prisma (P2002).
 *
 * Checagem estrutural em vez de `instanceof PrismaClientKnownRequestError`:
 * importar a classe de erro do Prisma no caso de uso amarraria a regra de
 * negocio ao ORM, e o `code` e contrato publico e estavel.
 */
function erroDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002';
}
