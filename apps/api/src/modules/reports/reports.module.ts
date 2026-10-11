import { Module } from '@nestjs/common';

import { ConsultarRelatorioDeAlunosUseCase } from './consultar-relatorio-de-alunos.use-case.js';
import { RelatorioDeAlunosRepository } from './relatorio-de-alunos.repository.js';

/** Relatórios -- F90. */
@Module({
  providers: [RelatorioDeAlunosRepository, ConsultarRelatorioDeAlunosUseCase],
  exports: [RelatorioDeAlunosRepository, ConsultarRelatorioDeAlunosUseCase],
})
export class ReportsModule {}
