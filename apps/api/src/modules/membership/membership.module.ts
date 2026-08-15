import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { StudentsModule } from '../students/students.module.js';
import { MembershipController } from './membership.controller.js';
import { MembershipRepository } from './membership.repository.js';

@Module({
  // Importa o modulo inteiro, e nao o provider solto: e o `StudentsModule`
  // que decide o que expoe (regra de arquitetura no 9).
  imports: [StudentsModule],
  controllers: [MembershipController],
  providers: [MembershipRepository, TenantContextService],
  exports: [MembershipRepository],
})
export class MembershipModule {}
