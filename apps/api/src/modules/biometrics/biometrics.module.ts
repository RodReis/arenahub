import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { DevicesModule } from '../devices/devices.module.js';
import { PrivacyModule } from '../privacy/privacy.module.js';
import { StudentsModule } from '../students/students.module.js';
import { BiometricIdentityRepository } from './biometric-identity.repository.js';
import { BiometricsController } from './biometrics.controller.js';
import { EdgeLegacyLinkController } from './edge-legacy-link.controller.js';
import { VincularCadastroLegadoUseCase } from './vincular-cadastro-legado.use-case.js';

/**
 * Identidade biometrica e seu ciclo de vida.
 *
 * Depende de tres modulos por caso de uso publico (regra de arquitetura
 * no 9): `privacy` diz se ha consentimento valido, `students` valida o
 * aluno, `devices` lista os alvos de sync. Nenhum deles e consultado por
 * tabela.
 */
@Module({
  imports: [PrivacyModule, StudentsModule, DevicesModule],
  controllers: [BiometricsController, EdgeLegacyLinkController],
  providers: [BiometricIdentityRepository, TenantContextService, VincularCadastroLegadoUseCase],
  exports: [BiometricIdentityRepository],
})
export class BiometricsModule {}
