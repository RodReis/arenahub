import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { BillingController } from './billing.controller.js';
import { BillingRepository } from './billing.repository.js';

/**
 * Financeiro -- MVP 2, Slice 2.1 (F12).
 *
 * Exportar o repositorio permite que a fatia seguinte (2.2, PIX) e o job
 * de vencimento (2.4) consumam sem duplicar regra.
 *
 * Regra de arquitetura no 9: quem precisa do financeiro importa ESTE
 * modulo, nunca a tabela.
 */
@Module({
  controllers: [BillingController],
  providers: [BillingRepository, TenantContextService],
  exports: [BillingRepository],
})
export class BillingModule {}
