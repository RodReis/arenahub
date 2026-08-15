import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { IamController } from './iam.controller.js';
import { InvitationService } from './invitation.service.js';

@Module({
  imports: [AuthModule],
  controllers: [IamController],
  providers: [InvitationService, TenantContextService],
})
export class IamModule {}
