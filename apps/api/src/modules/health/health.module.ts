import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';

import { carregarConfig } from '../../config/env.js';
import { StorageModule } from '../../common/storage/storage.module.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { StudentsModule } from '../students/students.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AssessmentController } from './assessment.controller.js';
import { AssessmentRepository } from './assessment.repository.js';
import { AttendanceRepository } from './attendance.repository.js';
import { AttendanceService } from './attendance.service.js';
import { AiAnalysisController } from './ai-analysis.controller.js';
import { BodyEvolutionController } from './body-evolution.controller.js';
import { BodyEvolutionService } from './body-evolution.service.js';
import { ImportController } from './import.controller.js';
import { ImportRepository } from './import.repository.js';
import { ImportService } from './import.service.js';
import { escolherOcrReal, escolherProvedorDeIa } from './provider/anthropic-gate.js';
import { ANTHROPIC_OCR_EXTRACTOR } from './provider/anthropic-ocr-extractor.token.js';
import { CsvDocumentExtractorAdapter } from './provider/csv-document-extractor.adapter.js';
import { DocumentExtractorRouterAdapter } from './provider/document-extractor-router.adapter.js';
import { DOCUMENT_EXTRACTOR, type DocumentExtractor } from './provider/document-extractor.port.js';
import { FakeOcrExtractorAdapter } from './provider/fake-ocr-extractor.adapter.js';
import { LaudoBioimpedanciaExtractor } from './provider/laudo-bioimpedancia.extractor.js';
import { AiAnalysisRepository } from './ai-analysis.repository.js';
import { AiAnalysisService } from './ai-analysis.service.js';
import { AI_PROVIDER, type AiProvider } from './provider/ai-provider.port.js';
import { FakeAiProviderAdapter } from './provider/fake-ai-provider.adapter.js';
import { GoalRepository } from './goal.repository.js';
import { HealthExportService } from './health-export.service.js';
import { HealthProgressController } from './health-progress.controller.js';
import { HealthProgressService } from './health-progress.service.js';

/** Token do cliente Anthropic, `null` quando nao ha `ANTHROPIC_API_KEY`. */
const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');

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
    BodyEvolutionController,
    AiAnalysisController,
    ImportController,
  ],
  providers: [
    AssessmentRepository,
    AttendanceRepository,
    AttendanceService,
    BodyEvolutionService,
    AiAnalysisRepository,
    AiAnalysisService,
    ImportRepository,
    ImportService,
    // O parser de CSV e PRODUCAO -- deterministico, sem terceiro. CSV e PDF
    // (laudo de bioimpedancia e ECG) tem extrator real (`LaudoBioimpedanciaExtractor`);
    // imagem (PNG/JPEG) vai para o OCR real da Anthropic quando ha chave
    // (ADR-036) -- `DocumentExtractorRouterAdapter` manda cada tipo para quem
    // tem implementacao de verdade, e o dublê so responde na ausencia da
    // chave ou em teste.
    CsvDocumentExtractorAdapter,
    FakeOcrExtractorAdapter,
    LaudoBioimpedanciaExtractor,
    DocumentExtractorRouterAdapter,
    { provide: DOCUMENT_EXTRACTOR, useExisting: DocumentExtractorRouterAdapter },
    FakeAiProviderAdapter,
    /**
     * Cliente Anthropic unico do modulo, `null` sem `ANTHROPIC_API_KEY` --
     * OCR e analise dependem dele, e um cliente so evita duas leituras de
     * config divergentes.
     */
    {
      provide: ANTHROPIC_CLIENT,
      useFactory: (): Anthropic | null => {
        const config = carregarConfig();

        return config.anthropicApiKey === null
          ? null
          : new Anthropic({ apiKey: config.anthropicApiKey });
      },
    },
    /**
     * OCR real (ADR-036): `null` sem chave OU em teste -- o roteador cai
     * para o dublê nos dois casos (`@Optional` em
     * `DocumentExtractorRouterAdapter`). Regra em `escolherOcrReal`
     * (`anthropic-gate.ts`), testada isoladamente sem subir o modulo inteiro.
     */
    {
      provide: ANTHROPIC_OCR_EXTRACTOR,
      inject: [ANTHROPIC_CLIENT],
      useFactory: (client: Anthropic | null): DocumentExtractor | null =>
        escolherOcrReal(client, carregarConfig().ambiente),
    },
    /**
     * Analise assistiva (ADR-036): mesma regra do OCR -- real com chave fora
     * de teste, dublê caso contrario. Regra em `escolherProvedorDeIa`.
     */
    {
      provide: AI_PROVIDER,
      inject: [ANTHROPIC_CLIENT, FakeAiProviderAdapter],
      useFactory: (client: Anthropic | null, fake: FakeAiProviderAdapter): AiProvider =>
        escolherProvedorDeIa(client, carregarConfig().ambiente, fake),
    },
    GoalRepository,
    HealthProgressService,
    HealthExportService,
    TenantContextService,
  ],
  exports: [
    AssessmentRepository,
    /*
     * Exportados para o TOTEM (F52). `BodyEvolutionService` ja foi ESCRITO
     * para esta superficie -- o cabecalho dele diz que a serie que o celular
     * e o totem consomem sai dali -- e ate a F52 nao tinha consumidor.
     *
     * A LEITURA (a cor de cada faixa) e resolvida no servidor de proposito:
     * se cada superficie calculasse a propria, o aluno veria o braco verde no
     * celular e amarelo no totem. Exportar o servico, e nao o repositorio,
     * e o que mantem essa garantia (regra de arquitetura no 9).
     */
    BodyEvolutionService,
    HealthProgressService,
    /*
     * Exportado para o APP (F24, Slice 4.2). `M4-FR-008` manda "exibir
     * frequencia DERIVADA PELO BACKEND", e a derivacao inteira -- passagem
     * elegivel, dia civil local, agregacao, consistencia -- ja mora aqui
     * desde a F18.
     *
     * O SERVICO, e nao `AttendanceRepository`: o repositorio le
     * `access_events` e `access_passages`, e expo-lo convidaria o BFF do app
     * a montar a propria contagem. Duas contagens divergem, e a divergencia
     * so apareceria quando alguem comparasse o app com o painel.
     */
    AttendanceService,
    /*
     * Exportados para o APP (F26, Slice 4.4).
     *
     * `AiAnalysisService` e nao o repositorio: `ultimaPublicada` e o unico
     * caminho que devolve analise JA ENDOSSADA por um profissional (regra de
     * arquitetura no 8). Expor o repositorio deixaria o BFF do app ler
     * rascunho ou saida rejeitada, que e exatamente o que a confirmacao
     * humana existe para impedir.
     *
     * `HealthExportService` porque a exportacao do historico e a MESMA para
     * painel e app desde que virou assincrona -- duas politicas de
     * exportacao para o mesmo dado dariam dois lugares para o expurgo errar.
     */
    AiAnalysisService,
    HealthExportService,
  ],
})
export class HealthModule {}
