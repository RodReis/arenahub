import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { StudentsModule } from '../students/students.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AssessmentController } from './assessment.controller.js';
import { AssessmentRepository } from './assessment.repository.js';
import { GoalRepository } from './goal.repository.js';
import { HealthProgressService } from './health-progress.service.js';

/**
 * Avaliacao fisica, medidas e contexto de saude (F17, Slice 3.1).
 *
 * Importa `StudentsModule` para consultar o aluno pelo repositorio publico
 * (regra de arquitetura no 9) -- ler `db.student` daqui apodreceria no dia
 * em que a regra de existencia do aluno mudasse de um lado so.
 *
 * Exporta o repositorio porque a F18 (historico e comparativos) e a F21
 * (analise assistiva) leem avaliacao publicada, e nenhuma delas pode tocar
 * `body_assessments` por fora.
 */
@Module({
  // `TenancyModule` entra pela F18: o corte de periodo do grafico cai na
  // meia-noite LOCAL da unidade, e o fuso vem do repositorio publico dela --
  // nunca de `db.gymUnit` daqui (regra de arquitetura no 9).
  imports: [StudentsModule, TenancyModule],
  controllers: [AssessmentController],
  providers: [AssessmentRepository, GoalRepository, HealthProgressService, TenantContextService],
  exports: [AssessmentRepository],
})
export class HealthModule {}
