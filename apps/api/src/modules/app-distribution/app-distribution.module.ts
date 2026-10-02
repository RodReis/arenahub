import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { AppDistributionController } from './app-distribution.controller.js';
import { AppDistributionRepository } from './app-distribution.repository.js';
import { LinkPublicoController } from './link-publico.controller.js';

@Module({
  controllers: [AppDistributionController, LinkPublicoController],
  providers: [AppDistributionRepository, TenantContextService],
  exports: [AppDistributionRepository],
})
export class AppDistributionModule {}
