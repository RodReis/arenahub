import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { TeamController } from './team.controller.js';
import { TeamRepository } from './team.repository.js';

@Module({
  controllers: [TeamController],
  providers: [TeamRepository, TenantContextService],
})
export class TeamModule {}
