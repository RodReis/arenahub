import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { BillingController } from './billing.controller.js';
import { BillingRepository } from './billing.repository.js';
import { AplicarInadimplenciaUseCase } from './aplicar-inadimplencia.use-case.js';
import { ConsultarInadimplenciaUseCase } from './consultar-inadimplencia.use-case.js';
import { CancelarRecorrenciaUseCase } from './cancelar-recorrencia.use-case.js';
import { LiberacaoFinanceiraUseCase } from './liberacao-financeira.use-case.js';
import { CobrarAssinaturaNoCartaoUseCase } from './cobrar-assinatura-no-cartao.use-case.js';
import { RegistrarMetodoDePagamentoUseCase } from './registrar-metodo-de-pagamento.use-case.js';
import { ConsultarStatusDePagamentoUseCase } from './consultar-status-de-pagamento.use-case.js';
import { ConsultarTentativaUseCase } from './consultar-tentativa.use-case.js';
import { ConciliarMovimentosUseCase } from './conciliar-movimentos.use-case.js';
import { CriarCobrancaPixUseCase } from './criar-cobranca-pix.use-case.js';
import { CriarCheckoutDeCartaoUseCase } from './criar-checkout-de-cartao.use-case.js';
import { EmitirReciboUseCase } from './emitir-recibo.use-case.js';
import { EstornarPagamentoUseCase } from './estornar-pagamento.use-case.js';
import { EstornoConciliacaoController } from './estorno-conciliacao.controller.js';
import { ObservarEstornoUseCase } from './observar-estorno.use-case.js';
import { ResolverDivergenciaUseCase } from './resolver-divergencia.use-case.js';
import { ProcessarWebhookDePagamentoUseCase } from './processar-webhook-de-pagamento.use-case.js';
import { FakePaymentProvider } from './provider/fake-payment-provider.adapter.js';
import { PAYMENT_PROVIDER } from './provider/payment-provider.port.js';
import { ProviderAccountResolver } from './provider/provider-account.resolver.js';
import { WebhookController } from './webhook.controller.js';

/**
 * Financeiro -- MVP 2, Slices 2.1 (F12) a 2.5 (F16).
 *
 * Exportar o repositorio permite que a fatia seguinte e o job de vencimento
 * (2.4) consumam sem duplicar regra.
 *
 * Regra de arquitetura no 9: quem precisa do financeiro importa ESTE
 * modulo, nunca a tabela.
 *
 * O PROVEDOR E REGISTRADO PELO TOKEN, nao pela classe: o caso de uso depende
 * de `PaymentProvider`, e trocar o duble pelo adapter real nao toca em
 * nenhum caso de uso.
 *
 * SAO DOIS PROVEDORES (ADR-032): Sicoob para PIX, Getnet para cartao. QUAL
 * conta atende cada capacidade sai do `ProviderAccountResolver`, que le
 * `provider_accounts.capability` -- nunca de um `if` por marca.
 *
 * O `FakePaymentProvider` continua sendo o unico adapter que existe: os dois
 * adapters reais dependem de credencial e sandbox, e a matriz do gate
 * (`docs/reports/MVP-02-matriz-de-homologacao-de-provedor.md`) marcou como
 * NAO VERIFICADO justamente o que eles precisariam honrar -- assinatura de
 * webhook, estorno parcial, chave estavel de evento. Escrever adapter contra
 * documentacao nao confirmada produziria codigo que parece pronto e falha na
 * primeira chamada real.
 */
@Module({
  /**
   * `AuthModule` entra para o step-up do estorno (INV-074): ele ja exporta
   * `MfaService`, e `MfaService` depende do `CIFRADOR_DE_MFA`, que so o
   * `AuthModule` prove. Registrar o servico solto aqui compilaria e falharia
   * em RUNTIME, na primeira tentativa de estorno.
   */
  imports: [AuthModule],
  controllers: [BillingController, WebhookController, EstornoConciliacaoController],
  providers: [
    BillingRepository,
    CriarCobrancaPixUseCase,
    CriarCheckoutDeCartaoUseCase,
    ConsultarStatusDePagamentoUseCase,
    ConsultarTentativaUseCase,
    ProcessarWebhookDePagamentoUseCase,
    TenantContextService,
    ProviderAccountResolver,
    RegistrarMetodoDePagamentoUseCase,
    CobrarAssinaturaNoCartaoUseCase,
    CancelarRecorrenciaUseCase,
    AplicarInadimplenciaUseCase,
    ConsultarInadimplenciaUseCase,
    LiberacaoFinanceiraUseCase,
    EstornarPagamentoUseCase,
    ObservarEstornoUseCase,
    ConciliarMovimentosUseCase,
    ResolverDivergenciaUseCase,
    EmitirReciboUseCase,
    { provide: PAYMENT_PROVIDER, useClass: FakePaymentProvider },
  ],
  /**
   * `LiberacaoFinanceiraUseCase` e exportado porque o modulo de ACESSO precisa
   * saber se ha liberacao viva antes de negar por divida.
   *
   * REGRA DE ARQUITETURA No 9: o acesso consome um CASO DE USO PUBLICO, nunca
   * a tabela `financial_access_overrides`. Se a forma da liberacao mudar --
   * virar por unidade, ganhar aprovacao em dois niveis --, quem se ajusta e
   * este modulo, e o de acesso nem fica sabendo.
   */
  exports: [BillingRepository, PAYMENT_PROVIDER, LiberacaoFinanceiraUseCase],
})
export class BillingModule {}
