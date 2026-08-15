import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { StudentRepository } from './student.repository.js';
import { StudentsController } from './students.controller.js';

@Module({
  controllers: [StudentsController],
  providers: [StudentRepository, TenantContextService],
  // Exportado porque `membership` precisa consultar o aluno -- por provider
  // publico, nunca lendo a tabela do outro modulo (regra de arquitetura 9).
  exports: [StudentRepository],
})
export class StudentsModule {}
