import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { BillingRepository } from './billing.repository.js';

/**
 * Financeiro -- MVP 2, Slice 2.1 (F12).
 *
 * Sem controller nesta entrega: a Slice 2.1 entrega ledger, invoice e
 * pagamento manual como CASO DE USO, e o endpoint entra junto da tela.
 * Exportar o repositorio permite que a fatia seguinte (2.2, PIX) e o job
 * de vencimento (2.4) consumam sem duplicar regra.
 *
 * Regra de arquitetura no 9: quem precisa do financeiro importa ESTE
 * modulo, nunca a tabela.
 */
@Module({
  providers: [BillingRepository, TenantContextService],
  exports: [BillingRepository],
})
export class BillingModule {}
