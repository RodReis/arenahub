import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { GymUnitController } from './gym-unit.controller.js';
import { GymUnitRepository } from './gym-unit.repository.js';

@Module({
  controllers: [GymUnitController],
  providers: [GymUnitRepository, TenantContextService],
  // Exportado para o `students` validar a unidade de origem do aluno por
  // caso de uso publico, e nao lendo `gym_units` direto (regra de
  // arquitetura no 9).
  exports: [GymUnitRepository],
})
export class TenancyModule {}
