import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { ClassController } from './class.controller.js';
import { ClassRepository } from './class.repository.js';

/**
 * Agenda de aulas -- F77 (SPEC-077, ADR-061).
 *
 * MODULO OPERACIONAL PROPRIO (ADR-061 decisao 1), nao acessorio de
 * `membership`: a grade serve a recepcao mesmo sem nenhum plano com aula
 * inclusa.
 */
@Module({
  // `TenancyModule` porque unidade e modalidade tem de existir NESTE tenant
  // antes de virar FK do jeito de `GymUnitModalityController` -- mesmo
  // motivo de `students` importar `TenancyModule`.
  imports: [TenancyModule],
  controllers: [ClassController],
  providers: [ClassRepository, TenantContextService],
})
export class ClassesModule {}
