import { Module } from '@nestjs/common';

import { PlatformContextService } from '../../common/platform/platform-context.service.js';
import { PlatformController } from './platform.controller.js';

@Module({
  controllers: [PlatformController],
  providers: [PlatformContextService],
  exports: [PlatformContextService],
})
export class PlatformModule {}
