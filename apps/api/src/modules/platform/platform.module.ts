import { Module } from '@nestjs/common';

import { PlatformContextService } from '../../common/platform/platform-context.service.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { AlterarTenantUseCase } from './alterar-tenant.use-case.js';
import { BrandingPublicoController } from './branding-publico.controller.js';
import { BrandingService } from './branding.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { ContratosController } from './contratos.controller.js';
import { CriarTenantUseCase } from './criar-tenant.use-case.js';
import { ElevarUseCase } from './elevar.use-case.js';
import { FaturasController, PreviaDeFaturaController } from './faturas.controller.js';
import { EncerrarElevacaoUseCase } from './encerrar-elevacao.use-case.js';
import { IamModule } from '../iam/iam.module.js';
import { IndexValueUseCase } from './index-value.use-case.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { PlatformController } from './platform.controller.js';
import { PlatformInvoiceSchedulerService } from './platform-invoice-scheduler.service.js';
import { PlatformInvoiceUseCase } from './platform-invoice.use-case.js';
import { SaasPlanUseCase } from './saas-plan.use-case.js';
import { SuspenderTenantUseCase } from './suspender-tenant.use-case.js';
import { TenantContractUseCase } from './tenant-contract.use-case.js';
import { TenantRepository } from './tenant.repository.js';

@Module({
  // `IamModule` pelo `EmailDeConviteService`: o convite do OWNER sai pelo
  // mesmo servico do convite de usuario.
  // `AuthModule` pelo `TokenService`: a elevacao emite o access token com o
  // tenant alvo, pelo mesmo emissor do login.
  imports: [IamModule, AuthModule],
  /*
   * TRES CONTROLLERS, e a separacao e a protecao: `PlatformController` e
   * `ContratosController` sao `@PlatformRoute()` na classe -- toda rota nova
   * neles nasce protegida --, e o `BrandingPublicoController` e `@Public()`
   * na classe. Uma rota publica dentro dos dois primeiros seria a excecao que
   * o proximo autor herda como duvida.
   *
   * O de contratos e SEPARADO (F63) porque plano, contrato e indice sao um
   * assunto proprio: uma classe que cresce por acumulo vira o lugar onde
   * ninguem acha nada.
   */
  controllers: [
    PlatformController,
    BrandingPublicoController,
    ContratosController,
    FaturasController,
    PreviaDeFaturaController,
  ],
  providers: [
    PlatformContextService,
    // `PreviaDeFaturaController` e do TENANT, nao da plataforma: le o
    // `tenantId` do contexto autenticado (regra 2). Cada modulo provê a
    // propria instancia -- mesmo padrao de `BillingModule`.
    TenantContextService,
    PlatformAuditService,
    TenantRepository,
    CriarTenantUseCase,
    AlterarTenantUseCase,
    ElevarUseCase,
    EncerrarElevacaoUseCase,
    BrandingService,
    SaasPlanUseCase,
    TenantContractUseCase,
    IndexValueUseCase,
    PlatformInvoiceUseCase,
    SuspenderTenantUseCase,
    PlatformInvoiceSchedulerService,
  ],
  exports: [PlatformContextService, PlatformAuditService, TenantRepository],
})
export class PlatformModule {}
