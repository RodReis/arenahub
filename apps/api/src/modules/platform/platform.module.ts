import { Module } from '@nestjs/common';

import { PlatformContextService } from '../../common/platform/platform-context.service.js';
import { CriarTenantUseCase } from './criar-tenant.use-case.js';
import { IamModule } from '../iam/iam.module.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { PlatformController } from './platform.controller.js';
import { TenantRepository } from './tenant.repository.js';

@Module({
  // `IamModule` pelo `EmailDeConviteService`: o convite do OWNER sai pelo
  // mesmo servico do convite de usuario.
  imports: [IamModule],
  controllers: [PlatformController],
  providers: [PlatformContextService, PlatformAuditService, TenantRepository, CriarTenantUseCase],
  exports: [PlatformContextService, PlatformAuditService, TenantRepository],
})
export class PlatformModule {}
