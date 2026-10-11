import { Module } from '@nestjs/common';

import { CabecalhoDaAcademiaService } from './cabecalho-da-academia.service.js';
import { ConsultarRelatorioDeAlunosUseCase } from './consultar-relatorio-de-alunos.use-case.js';
import { RelatorioDeAlunosRepository } from './relatorio-de-alunos.repository.js';

/** Relatórios -- F90. */
@Module({
  providers: [RelatorioDeAlunosRepository, ConsultarRelatorioDeAlunosUseCase, CabecalhoDaAcademiaService],
  exports: [RelatorioDeAlunosRepository, ConsultarRelatorioDeAlunosUseCase, CabecalhoDaAcademiaService],
})
export class ReportsModule {}
