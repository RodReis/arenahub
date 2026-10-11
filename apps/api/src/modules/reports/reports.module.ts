import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { CabecalhoDaAcademiaService } from './cabecalho-da-academia.service.js';
import { ConsultarRelatorioDeAlunosUseCase } from './consultar-relatorio-de-alunos.use-case.js';
import { RelatorioDeAlunosRepository } from './relatorio-de-alunos.repository.js';
import { ReportsController } from './reports.controller.js';

/** Relatórios -- F90. */
@Module({
  controllers: [ReportsController],
  providers: [
    RelatorioDeAlunosRepository,
    ConsultarRelatorioDeAlunosUseCase,
    CabecalhoDaAcademiaService,
    TenantContextService,
  ],
  exports: [RelatorioDeAlunosRepository, ConsultarRelatorioDeAlunosUseCase, CabecalhoDaAcademiaService],
})
export class ReportsModule {}
