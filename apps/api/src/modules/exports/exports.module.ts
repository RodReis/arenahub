import { Module } from '@nestjs/common';

import { StorageModule } from '../../common/storage/storage.module.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { AccessQueryModule } from '../access-query/access-query.module.js';
import { ExportsController } from './exports.controller.js';
import { ExportsService } from './exports.service.js';

/** Exportacao assincrona -- F11. */
@Module({
  imports: [StorageModule, AccessQueryModule],
  controllers: [ExportsController],
  providers: [ExportsService, TenantContextService],
  exports: [ExportsService],
})
export class ExportsModule {}
