import { Inject, Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  ErroDoProvedor,
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './provider/payment-provider.port.js';

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
     * As recorrencias vivas desta assinatura sao as tentativas de CARTAO que
     * chegaram a receber identificador do provedor. Tentativa que falhou
     * antes disso nunca criou combinado nenhum la.
     */
    const vivas = await this.db.paymentAttempt.findMany({
      where: {
        tenantId: contexto.tenantId,
        method: 'CARD',
        externalPaymentId: { not: null },
        invoice: { subscriptionId: assinatura.id },
      },
      select: { id: true, externalPaymentId: true },
    });

    let canceladas = 0;

    for (const tentativa of vivas) {
      if (tentativa.externalPaymentId === null) {
        continue;
      }

      try {
        await this.provedor.cancelSubscription(tentativa.externalPaymentId);
        canceladas += 1;
      } catch (erro) {
        /**
         * RECORRENCIA JA INEXISTENTE NAO E FALHA. O aluno pode ter cancelado
         * pelo app do banco, ou o provedor pode ter encerrado por conta
         * propria -- em ambos os casos o estado desejado JA VALE, e devolver
         * erro faria a recepcao tentar de novo para sempre.
         *
         * Qualquer outro erro sobe: nao cancelar de verdade e continuar
         * cobrando o aluno e o pior resultado possivel aqui.
         */
        if (erro instanceof ErroDoProvedor && erro.codigo === 'PROVIDER_NOT_FOUND') {
          continue;
        }

        throw erro;
      }
    }

    return { subscriptionId: assinatura.id, canceladasNoProvedor: canceladas };
  }
}
