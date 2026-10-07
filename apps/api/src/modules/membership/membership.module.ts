import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { BillingModule } from '../billing/billing.module.js';
import { StudentsModule } from '../students/students.module.js';
import { AplicarTrocasAgendadasSchedulerService } from './aplicar-trocas-agendadas-scheduler.service.js';
import { MembershipController } from './membership.controller.js';
import { MembershipRepository } from './membership.repository.js';
import { VenderDiariaUseCase } from './vender-diaria.use-case.js';

@Module({
  // Importa o modulo inteiro, e nao o provider solto: e o `StudentsModule`
  // que decide o que expoe (regra de arquitetura no 9).
  imports: [StudentsModule, BillingModule],
  controllers: [MembershipController],
  providers: [
    MembershipRepository,
    TenantContextService,
    AplicarTrocasAgendadasSchedulerService,
    VenderDiariaUseCase,
  ],
  exports: [MembershipRepository],
})
export class MembershipModule {}
