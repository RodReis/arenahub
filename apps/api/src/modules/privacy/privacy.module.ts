import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { StudentsModule } from '../students/students.module.js';
import { ConsentController } from './consent.controller.js';
import { ConsentRepository } from './consent.repository.js';

/**
 * Consentimento e politica de privacidade.
 *
 * Importa `StudentsModule` para consultar o aluno pelo provider publico
 * (regra de arquitetura no 9) -- a data de nascimento define quem precisa
 * consentir (INV-143), e ler `db.student` daqui apodreceria no dia em que a
 * elegibilidade mudasse de um lado so.
 *
 * Exporta o repositorio porque `biometrics` precisa checar consentimento
 * antes de criar identidade (INV-017).
 */
@Module({
  imports: [StudentsModule],
  controllers: [ConsentController],
  providers: [ConsentRepository, TenantContextService],
  exports: [ConsentRepository],
})
export class PrivacyModule {}
