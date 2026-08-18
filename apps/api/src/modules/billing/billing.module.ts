import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { BillingController } from './billing.controller.js';
import { BillingRepository } from './billing.repository.js';
import { ConsultarStatusDePagamentoUseCase } from './consultar-status-de-pagamento.use-case.js';
import { CriarCobrancaPixUseCase } from './criar-cobranca-pix.use-case.js';
import { ProcessarWebhookDePagamentoUseCase } from './processar-webhook-de-pagamento.use-case.js';
import { FakePaymentProvider } from './provider/fake-payment-provider.adapter.js';
import { PAYMENT_PROVIDER } from './provider/payment-provider.port.js';
import { WebhookController } from './webhook.controller.js';

/**
 * Financeiro -- MVP 2, Slices 2.1 (F12) e 2.2 (F13).
 *
 * Exportar o repositorio permite que a fatia seguinte e o job de vencimento
 * (2.4) consumam sem duplicar regra.
 *
 * Regra de arquitetura no 9: quem precisa do financeiro importa ESTE
 * modulo, nunca a tabela.
 *
 * O PROVEDOR E REGISTRADO PELO TOKEN, nao pela classe: o caso de uso depende
 * de `PaymentProvider`, e trocar o duble pelo adapter homologado (quando o
 * card `[GATE]` do ADR-013 escolher um) nao toca em nenhum caso de uso.
 *
 * ENQUANTO O PROVEDOR NAO FOR ESCOLHIDO, o `FakePaymentProvider` e o unico
 * adapter que existe. Ele nao e "modo de teste": e o estado real do sistema
 * ate a homologacao acontecer. Um adapter real entra aqui como mais um
 * `useClass`, decidido por ambiente.
 */
@Module({
  controllers: [BillingController, WebhookController],
  providers: [
    BillingRepository,
    CriarCobrancaPixUseCase,
    ConsultarStatusDePagamentoUseCase,
    ProcessarWebhookDePagamentoUseCase,
    TenantContextService,
    { provide: PAYMENT_PROVIDER, useClass: FakePaymentProvider },
  ],
  exports: [BillingRepository, PAYMENT_PROVIDER],
})
export class BillingModule {}
