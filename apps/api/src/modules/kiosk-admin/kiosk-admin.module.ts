import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { PersistenceModule } from '../../persistence/persistence.module.js';
import { KioskAdminConfigService } from './kiosk-admin-config.service.js';
import { KioskAdminController } from './kiosk-admin.controller.js';
import { KioskMediaService } from './kiosk-media.service.js';

@Module({
  imports: [PersistenceModule],
  controllers: [KioskAdminController],
  providers: [KioskAdminConfigService, KioskMediaService, TenantContextService],
})
export class KioskAdminModule {}
