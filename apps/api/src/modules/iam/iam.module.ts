import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { IamController } from './iam.controller.js';
import { InvitationService } from './invitation.service.js';
import { MembershipRepository } from './membership.repository.js';

@Module({
  imports: [AuthModule],
  controllers: [IamController],
  providers: [InvitationService, MembershipRepository, TenantContextService],
  // Exportado para o `students` validar o consultor responsavel por caso de
  // uso publico, e nao lendo `tenant_memberships` direto (regra no 9).
  exports: [MembershipRepository],
})
export class IamModule {}
