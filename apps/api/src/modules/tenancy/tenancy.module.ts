import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { GymUnitController } from './gym-unit.controller.js';
import { GymUnitRepository } from './gym-unit.repository.js';

@Module({
  controllers: [GymUnitController],
  providers: [GymUnitRepository, TenantContextService],
})
export class TenancyModule {}
