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
      select: { id: true },
    });

    if (!assinatura) {
      throw new AssinaturaNaoEncontradaParaCancelamentoError();
    }

    /**
     * NAO HA RECORRENCIA INSTALADA PARA CANCELAR -- ainda (ADR-043, Decisao 5).
     *
     * Ate 25/08/2026 este laco varria `payment_attempts` de cartao e passava
     * `externalPaymentId` para `cancelSubscription`. Aquilo so fazia sentido
     * por causa de um BUG: a cobranca de invoice chamava
     * `createTokenizedSubscription`, entao a coluna guardava, por acidente,
     * um id de ASSINATURA. Corrigida a cobranca para
     * `chargeTokenizedPayment`, a coluna guarda o que o nome sempre disse --
     * id de PAGAMENTO --, e mandar isso para `cancelSubscription` cancelaria
     * pelo identificador errado. Contra o duble seria `PROVIDER_NOT_FOUND`
     * silencioso; contra a Getnet real, um alvo errado.
     *
     * O ESTADO VERDADEIRO DO SISTEMA HOJE E ZERO: a F14 cobra invoice, e
     * cobrar invoice nao instala calendario nenhum. Recorrencia de verdade
     * nasce na **F56** (plano com assinatura mensal), que cria
     * `Subscription.externalSubscriptionId` -- a fonte correta desta leitura.
     * Enquanto ela nao existe, nao ha o que cancelar, e o contrato deste caso
     * de uso ja dizia que zero NAO e erro.
     *
     * O `cancelSubscription` da porta continua existindo e testado no duble:
     * quem o exercita e a F56. O `provedor` segue injetado por isso -- tirar
     * e recolocar na proxima fatia seria churn, e o campo documenta que este
     * caso de uso fala com o provedor.
     */
    return { subscriptionId: assinatura.id, canceladasNoProvedor: 0 };
  }
}
