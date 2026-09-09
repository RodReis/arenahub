import { Module } from '@nestjs/common';

import { PlatformContextService } from '../../common/platform/platform-context.service.js';
import { AlterarTenantUseCase } from './alterar-tenant.use-case.js';
import { BrandingPublicoController } from './branding-publico.controller.js';
import { BrandingService } from './branding.service.js';
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
  /*
   * DOIS CONTROLLERS, e a separacao e a protecao: o `PlatformController` e
   * `@PlatformRoute()` na classe -- toda rota nova nele nasce protegida --, e
   * o `BrandingPublicoController` e `@Public()` na classe. Uma rota publica
   * dentro do primeiro seria a excecao que o proximo autor herda como duvida.
   */
  controllers: [PlatformController, BrandingPublicoController],
  providers: [
    PlatformContextService,
    PlatformAuditService,
    TenantRepository,
    CriarTenantUseCase,
    AlterarTenantUseCase,
    ElevarUseCase,
    EncerrarElevacaoUseCase,
    BrandingService,
  ],
  exports: [PlatformContextService, PlatformAuditService, TenantRepository],
})
export class PlatformModule {}
