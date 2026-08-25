import { Inject, Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider/payment-provider.port.js';

/**
 * Cancela a recorrencia de cartao de uma assinatura. `MVP-02` 7, Slice 2.3:
 * "cancelamento da recorrencia".
 *
 * CANCELAR A RECORRENCIA NAO CANCELA A ASSINATURA. Sao coisas diferentes, e
 * confundi-las tira o acesso de quem pagou: a recorrencia e o COMBINADO DE
 * COBRANCA no provedor; a assinatura e o direito do aluno, que segue valendo
 * ate o fim do periodo ja pago. Quem decide o acesso e o entitlement (regra
 * de arquitetura no 1), e este caso de uso nao toca nele.
 *
 * O aluno que cancela hoje um plano pago ate o dia 30 continua entrando ate o
 * dia 30. Encerrar a assinatura e outro caso de uso, com outra permissao.
 */

export class AssinaturaNaoEncontradaParaCancelamentoError extends ErroDeDominio {
  constructor() {
    super('SUBSCRIPTION_NOT_FOUND', 404, 'Assinatura nao encontrada');
  }
}

export interface RecorrenciaCancelada {
  readonly subscriptionId: string;
  /**
   * Quantas recorrencias foram efetivamente canceladas no provedor. Zero
   * significa que nao havia nenhuma ativa -- que NAO e erro, ver abaixo.
   */
  readonly canceladasNoProvedor: number;
}

@Injectable()
export class CancelarRecorrenciaUseCase {
  constructor(
    private readonly db: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provedor: PaymentProvider,
  ) {}

  async executar(
    contexto: TenantContext,
    entrada: { subscriptionId: string },
  ): Promise<RecorrenciaCancelada> {
    const assinatura = await this.db.subscription.findFirst({
      where: { id: entrada.subscriptionId, tenantId: contexto.tenantId },
      select: { id: true, externalSubscriptionId: true },
    });

    if (!assinatura) {
      throw new AssinaturaNaoEncontradaParaCancelamentoError();
    }

    /**
     * A FONTE E `Subscription.externalSubscriptionId` -- ADR-043, Decisao 5.
     *
     * Ate 25/08/2026 este caso de uso varria `payment_attempts` e passava
     * `externalPaymentId` para `cancelSubscription`. Aquilo so funcionava por
     * causa de um bug: a cobranca de invoice chamava
     * `createTokenizedSubscription`, entao a coluna guardava, por acidente,
     * um id de assinatura. Corrigida a cobranca, o campo passou a guardar o
     * que o nome sempre disse, e a fonte correta nasceu aqui, na F56.
     *
     * ZERO CONTINUA NAO SENDO ERRO, e agora por dois motivos legitimos:
     * assinatura de plano AVULSO nunca instalou recorrencia, e assinatura de
     * plano ASSINATURA que ainda nao aderiu tambem nao. Em nenhum dos dois ha
     * o que cancelar.
     */
    if (assinatura.externalSubscriptionId === null) {
      return { subscriptionId: assinatura.id, canceladasNoProvedor: 0 };
    }

    /*
     * O PROVEDOR PRIMEIRO, o banco depois -- e a ordem oposta da cobranca,
     * de proposito.
     *
     * Na cobranca, gravar antes protege contra dinheiro que sai sem registro.
     * Aqui o risco e o inverso: limpar a coluna primeiro e falhar no provedor
     * deixaria uma recorrencia VIVA cobrando o aluno todo mes, sem nada no
     * ArenaHub apontando para ela -- invisivel ate a contestacao chegar.
     * Falhar no provedor com a coluna intacta e recuperavel: basta chamar de
     * novo.
     */
    await this.provedor.cancelSubscription(assinatura.externalSubscriptionId);

    /*
     * Condicionado ao id que acabamos de cancelar: se outra requisicao ja
     * limpou (ou trocou) a coluna, esta escrita nao afeta linha nenhuma em
     * vez de apagar o trabalho dela.
     */
    await this.db.subscription.updateMany({
      where: {
        id: assinatura.id,
        tenantId: contexto.tenantId,
        externalSubscriptionId: assinatura.externalSubscriptionId,
      },
      data: {
        externalSubscriptionId: null,
        recurrenceConsentAt: null,
        recurrenceConsentActorId: null,
      },
    });

    return { subscriptionId: assinatura.id, canceladasNoProvedor: 1 };
  }
}
