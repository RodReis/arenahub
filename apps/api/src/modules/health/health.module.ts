import { Module } from '@nestjs/common';

import { StorageModule } from '../../common/storage/storage.module.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { StudentsModule } from '../students/students.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AssessmentController } from './assessment.controller.js';
import { AssessmentRepository } from './assessment.repository.js';
import { AttendanceRepository } from './attendance.repository.js';
import { AttendanceService } from './attendance.service.js';
import { AiAnalysisController } from './ai-analysis.controller.js';
import { ImportController } from './import.controller.js';
import { ImportRepository } from './import.repository.js';
import { ImportService } from './import.service.js';
import { CsvDocumentExtractorAdapter } from './provider/csv-document-extractor.adapter.js';
import { DOCUMENT_EXTRACTOR } from './provider/document-extractor.port.js';
import { FakeOcrExtractorAdapter } from './provider/fake-ocr-extractor.adapter.js';
import { MALWARE_SCANNER } from './provider/malware-scanner.port.js';
import { FakeMalwareScannerAdapter } from './provider/fake-malware-scanner.adapter.js';
import { AiAnalysisRepository } from './ai-analysis.repository.js';
import { AiAnalysisService } from './ai-analysis.service.js';
import { AI_PROVIDER } from './provider/ai-provider.port.js';
import { FakeAiProviderAdapter } from './provider/fake-ai-provider.adapter.js';
import { GoalRepository } from './goal.repository.js';
import { HealthExportService } from './health-export.service.js';
import { HealthProgressController } from './health-progress.controller.js';
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
 *
 * A F20 (frequencia) LE `access_events`/`access_passages` pelo Prisma em modo
 * somente-leitura, e nunca escreve neles: a projecao de sessao e uma tabela
 * propria, e `M3-BR-008` exige agrupar "sem apagar eventos brutos".
 */
@Module({
  // `TenancyModule` entra pela F18: o corte de periodo do grafico cai na
  // meia-noite LOCAL da unidade, e o fuso vem do repositorio publico dela --
  // nunca de `db.gymUnit` daqui (regra de arquitetura no 9).
  // `StorageModule` entra pela exportacao (F18): o CSV nasce na API e vai
  // para o bucket privado, com URL assinada curta -- nunca pelo navegador.
  imports: [StudentsModule, TenancyModule, StorageModule],
  controllers: [
    AssessmentController,
    HealthProgressController,
    AiAnalysisController,
    ImportController,
  ],
  providers: [
    AssessmentRepository,
    AttendanceRepository,
    AttendanceService,
    AiAnalysisRepository,
    AiAnalysisService,
    ImportRepository,
    ImportService,
    // O parser de CSV e PRODUCAO -- deterministico, sem terceiro. O OCR de
    // imagem e PDF e dublê (ADR-017) ate existir extrator real; o roteador
    // manda CSV para o parser de verdade em qualquer ambiente.
    CsvDocumentExtractorAdapter,
    FakeOcrExtractorAdapter,
    { provide: DOCUMENT_EXTRACTOR, useExisting: FakeOcrExtractorAdapter },
    FakeMalwareScannerAdapter,
    { provide: MALWARE_SCANNER, useExisting: FakeMalwareScannerAdapter },
    FakeAiProviderAdapter,
    { provide: AI_PROVIDER, useExisting: FakeAiProviderAdapter },
    GoalRepository,
    HealthProgressService,
    HealthExportService,
    TenantContextService,
  ],
  exports: [AssessmentRepository],
})
export class HealthModule {}
