import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { AppDistributionController } from './app-distribution.controller.js';
import { AppDistributionRepository } from './app-distribution.repository.js';

@Module({
  controllers: [AppDistributionController],
  providers: [AppDistributionRepository, TenantContextService],
  exports: [AppDistributionRepository],
})
export class AppDistributionModule {}
