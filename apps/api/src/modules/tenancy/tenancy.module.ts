import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { GymUnitModalityController } from './gym-unit-modality.controller.js';
import { GymUnitModalityRepository } from './gym-unit-modality.repository.js';
import { GymUnitController } from './gym-unit.controller.js';
import { GymUnitRepository } from './gym-unit.repository.js';

@Module({
  controllers: [GymUnitModalityController, GymUnitController],
  providers: [GymUnitRepository, GymUnitModalityRepository, TenantContextService],
  // Exportado para o `students` validar a unidade de origem do aluno por
  // caso de uso publico, e nao lendo `gym_units` direto (regra de
  // arquitetura no 9). O mesmo vale para a modalidade (F60): o cadastro de
  // aluno precisa provar que a modalidade e da unidade escolhida.
  exports: [GymUnitRepository, GymUnitModalityRepository],
})
export class TenancyModule {}
