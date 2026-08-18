import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../../common/security/public.decorator.js';
import { ProcessarWebhookDePagamentoUseCase } from './processar-webhook-de-pagamento.use-case.js';

/**
 * Webhook do provedor de pagamento. `MVP-02` 13.
 *
 * CONTROLLER PROPRIO, separado do `BillingController`, porque a natureza da
 * rota e outra: nao tem sessao, nao tem tenant no contexto, nao tem
 * permissao. Quem autentica e o HMAC (INV-077) e quem resolve o tenant e a
 * conta do provedor (INV-078).
 *
 * `@Public()` NAO SIGNIFICA ABERTO. Significa "o guard de sessao nao se
 * aplica" -- provedor nao faz login. A autenticacao acontece no caso de uso,
 * antes de qualquer escrita, e requisicao sem assinatura valida morre ali.
 */
@Controller('api/v1/webhooks')
export class WebhookController {
  constructor(private readonly processar: ProcessarWebhookDePagamentoUseCase) {}

  /**
   * `200 SEMPRE que o evento foi recebido e guardado com seguranca`
   * (`MVP-02` 13).
   *
   * Duplicata, evento fora de ordem e tipo desconhecido tambem devolvem 200:
   * sao processamento CORRETO, nao falha. Responder 4xx faria o provedor
   * reenviar o mesmo evento indefinidamente, e a fila dele encheria com algo
   * que ja esta resolvido do nosso lado.
   *
   * O 401 continua sendo 401: assinatura invalida nao e evento nosso.
   */
  @Post('payments/:provider')
  @Public()
  @HttpCode(200)
  async receber(
    @Param('provider') provider: string,
    @Req() requisicao: Request,
  ): Promise<{ received: true; applied: boolean; providerEventId: string }> {
    /**
     * CORPO CRU, nao `requisicao.body`: a assinatura e sobre os bytes
     * exatos. O middleware global guarda o cru para este prefixo -- ver
     * `raw-body.middleware.ts`.
     *
     * Ausencia de `rawBody` vira `Buffer` vazio, que nao passa na
     * verificacao. Falhar como "nao autenticado" e o correto: nao ha corpo
     * assinado para conferir.
     */
    const rawBody = Buffer.from(requisicao.rawBody ?? '', 'utf8');

    const resultado = await this.processar.executar(
      { rawBody, headers: requisicao.headers as Record<string, string | undefined>, provider },
      new Date(),
    );

    return {
      received: true,
      applied: resultado.aplicado,
      providerEventId: resultado.providerEventId,
    };
  }
}
