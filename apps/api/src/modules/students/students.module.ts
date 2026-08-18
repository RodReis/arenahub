import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { StudentRepository } from './student.repository.js';
import { StudentsController } from './students.controller.js';

@Module({
  // `TenancyModule` porque a unidade de origem do aluno (F45) tem de existir
  // NESTE tenant antes de virar FK -- e quem sabe responder isso e o dono da
  // tabela, nao o `students` lendo `gym_units` por conta propria.
  imports: [TenancyModule],
  controllers: [StudentsController],
  providers: [StudentRepository, TenantContextService],
  // Exportado porque `membership` precisa consultar o aluno -- por provider
  // publico, nunca lendo a tabela do outro modulo (regra de arquitetura 9).
  exports: [StudentRepository],
})
export class StudentsModule {}
