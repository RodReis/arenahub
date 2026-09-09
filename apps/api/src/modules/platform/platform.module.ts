import { Module } from '@nestjs/common';

import { PlatformContextService } from '../../common/platform/platform-context.service.js';
import { AlterarTenantUseCase } from './alterar-tenant.use-case.js';
import { AuthModule } from '../auth/auth.module.js';
import { CriarTenantUseCase } from './criar-tenant.use-case.js';
import { ElevarUseCase } from './elevar.use-case.js';
import { EncerrarElevacaoUseCase } from './encerrar-elevacao.use-case.js';
import { IamModule } from '../iam/iam.module.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { PlatformController } from './platform.controller.js';
import { TenantRepository } from './tenant.repository.js';

@Module({
  // `IamModule` pelo `EmailDeConviteService`: o convite do OWNER sai pelo
  // mesmo servico do convite de usuario.
  // `AuthModule` pelo `TokenService`: a elevacao emite o access token com o
  // tenant alvo, pelo mesmo emissor do login.
  imports: [IamModule, AuthModule],
  controllers: [PlatformController],
  providers: [
    PlatformContextService,
    PlatformAuditService,
    TenantRepository,
    CriarTenantUseCase,
    AlterarTenantUseCase,
    ElevarUseCase,
    EncerrarElevacaoUseCase,
  ],
  exports: [PlatformContextService, PlatformAuditService, TenantRepository],
})
export class PlatformModule {}
