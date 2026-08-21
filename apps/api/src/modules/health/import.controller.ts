import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { ImportService } from './import.service.js';
import { TAMANHO_MAXIMO_BYTES } from './domain/arquivo-de-importacao.js';
import { UNIDADES_DE_MEDIDA, type UnidadeDeMedida } from './domain/medida.js';

/**
 * Upload e revisao de arquivo (F19, Slice 3.3).
 *
 * Rotas conforme o PRD (`MVP-03` secao 11):
 *
 *     POST /api/v1/students/:id/assessment-imports
 *     GET  /api/v1/assessment-imports/:id
 *     POST /api/v1/assessment-imports/:id/confirm
 *
 * Mais duas que o PRD nao lista e a revisao campo a campo exige -- sem elas o
 * `M3-FR-011` nao teria como acontecer:
 *
 *     PATCH /api/v1/assessment-imports/:id/fields/:fieldId
 *     POST  /api/v1/assessment-imports/:id/discard
 */

/**
 * O arquivo como o `FileInterceptor` o entrega.
 *
 * Declarado aqui em vez de instalar `@types/multer`: sao TRES campos, e o
 * pacote de tipos traria uma dependencia inteira para descrever o que cabe em
 * seis linhas. Se um dia o upload precisar de mais da API do multer, o pacote
 * entra -- por necessidade, nao por reflexo.
 */
interface ArquivoRecebido {
  readonly originalname: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
}

const esquemaDeRevisao = z
  .object({
    state: z.enum(['CONFIRMED', 'CORRECTED', 'DISCARDED']),
    reviewedValue: z.number().finite().positive().nullable().optional(),
    reviewedUnit: z.enum(UNIDADES_DE_MEDIDA as [UnidadeDeMedida, ...UnidadeDeMedida[]]).nullable().optional(),
  })
  .strict();

const esquemaDeConfirmacao = z
  .object({
    /** Instante da MEDICAO -- o documento nem sempre traz. */
    assessedAt: z.iso.datetime(),
  })
  .strict();

/**
 * O corpo do upload viaja como `multipart/form-data` (o arquivo vai no
 * campo `file`), entao `reviewSessionId`/`sourceLabel` chegam como CAMPOS DE
 * TEXTO do mesmo formulario -- nao um `Body()` JSON separado. `z.uuid()`
 * valida o formato antes de tratar como id de sessao real.
 */
const esquemaDoEnvio = z
  .object({
    reviewSessionId: z.uuid().optional(),
    sourceLabel: z.string().min(1).max(120).optional(),
  })
  .partial();

interface CampoDto {
  id: string;
  type: string;
  extractedValue: number | null;
  extractedUnit: string | null;
  confidence: number | null;
  sourceLocation: string | null;
  sourceLabel: string | null;
  state: string;
  reviewedValue: number | null;
  reviewedUnit: string | null;
}

interface ImportacaoDto {
  id: string;
  studentId: string;
  status: string;
  originalFilename: string;
  fileType: string;
  extractor: string | null;
  failureReason: string | null;
  assessmentId: string | null;
  createdAt: string;
  /** Em ORDEM DE REVISAO: menor confianca primeiro. */
  fields: CampoDto[];
}

@Controller('api/v1')
export class ImportController {
  constructor(
    private readonly importacoes: ImportService,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * Recebe o arquivo (`M3-FR-009`).
   *
   * `health.assess` e nao `health.read`: importar laudo e ato de quem avalia.
   */
  @Post('students/:id/assessment-imports')
  @RequirePermissions('health.assess')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TAMANHO_MAXIMO_BYTES } }))
  async enviar(
    @Param('id') studentId: string,
    @UploadedFile() arquivo: ArquivoRecebido | undefined,
    @Body() corpo: unknown,
  ): Promise<{
    id: string;
    status: string;
    extractedFields: number;
    failureReason: string | null;
    reviewSessionId: string;
  }> {
    if (!arquivo) {
      throw new BadRequestException({ code: 'FILE_REQUIRED' });
    }

    const dados = esquemaDoEnvio.parse(corpo);
    const contexto = this.contexto.require();
    const uploader = this.exigirAtor();

    const resultado = await this.importacoes.enviar(
      contexto,
      studentId,
      {
        originalFilename: arquivo.originalname,
        contentType: arquivo.mimetype,
        conteudo: new Uint8Array(arquivo.buffer),
      },
      uploader,
      { reviewSessionId: dados.reviewSessionId, sourceLabel: dados.sourceLabel },
    );

    return {
      id: resultado.id,
      status: resultado.status,
      extractedFields: resultado.camposExtraidos,
      failureReason: resultado.motivoDaFalha,
      reviewSessionId: resultado.reviewSessionId,
    };
  }

  /**
   * Fila de importacoes que precisam de atencao -- o painel da F22.
   *
   * `EXTRACTED` (esperando revisao), `FAILED` e `INFECTED` num lugar so:
   * quem opera a recepcao age sobre as tres da mesma tela, e separar em
   * abas produziria uma aba que ninguem abre.
   *
   * Rota ANTES de `assessment-imports/:id` de proposito: registrada depois,
   * o Nest casaria `pending` como um `:id` e a fila responderia 404.
   */
  @Get('assessment-imports/pending')
  @RequirePermissions('health.read')
  async fila(): Promise<
    {
      id: string;
      studentId: string;
      status: string;
      originalFilename: string;
      failureReason: string | null;
      pendingFields: number;
      createdAt: string;
    }[]
  > {
    const fila = await this.importacoes.fila(this.contexto.require());

    return fila.map((linha) => ({
      id: linha.id,
      studentId: linha.studentId,
      status: linha.status,
      originalFilename: linha.originalFilename,
      failureReason: linha.failureReason,
      pendingFields: linha.camposPendentes,
      createdAt: linha.createdAt.toISOString(),
    }));
  }

  /**
   * A sessao como a tela de revisao precisa dela (Task 5): arquivos, linhas
   * consolidadas entre eles e se pode confirmar.
   *
   * Rota `assessment-imports/sessions/:sessionId` tem DOIS segmentos depois
   * de `assessment-imports/`, entao `:id` (UM segmento) nunca a engoliria --
   * mas fica ANTES de `:id` de qualquer jeito, seguindo o mesmo cuidado de
   * `pending` acima: registrar rota literal perto de `:id` e um lugar onde
   * vale nao confiar so na contagem de segmentos.
   */
  @Get('assessment-imports/sessions/:sessionId')
  @RequirePermissions('health.read')
  async detalharSessao(@Param('sessionId') sessionId: string): Promise<{
    sessionId: string;
    arquivos: {
      importId: string;
      sourceLabel: string;
      tipoDeLaudo: string;
      /**
       * `extracted_attributes` cru do arquivo, OPACO (ADR-035) -- carrega
       * coisas como `ecgFinding`, nunca interpretado aqui nem no cliente,
       * so citado como texto atribuido ao aparelho.
       */
      atributos: Record<string, unknown> | null;
    }[];
    linhas: {
      type: string;
      concordante: boolean;
      origens: string[];
      campos: CampoDto[];
    }[];
    podeConfirmar: { pronta: boolean; motivo?: string };
  }> {
    const sessao = await this.importacoes.detalharSessao(this.contexto.require(), sessionId);

    return {
      sessionId: sessao.sessionId,
      arquivos: sessao.arquivos.map((arquivo) => ({
        importId: arquivo.importId,
        sourceLabel: arquivo.sourceLabel,
        tipoDeLaudo: arquivo.tipoDeLaudo,
        atributos: arquivo.atributos ?? null,
      })),
      linhas: sessao.linhas.map((linha) => ({
        type: linha.type,
        concordante: linha.concordante,
        origens: [...linha.origens],
        campos: linha.campos.map((campo) => ({
          id: campo.id,
          type: campo.type,
          extractedValue: campo.extractedValue,
          extractedUnit: campo.extractedUnit,
          confidence: campo.confidence,
          sourceLocation: campo.sourceLocation,
          sourceLabel: campo.sourceLabel,
          state: campo.state,
          reviewedValue: campo.reviewedValue,
          reviewedUnit: campo.reviewedUnit,
        })),
      })),
      podeConfirmar: sessao.podeConfirmar.pronta
        ? { pronta: true }
        : { pronta: false, motivo: sessao.podeConfirmar.motivo },
    };
  }

  /**
   * Confirma a sessao inteira e cria UMA avaliacao com as medidas de TODOS
   * os arquivos (Task 5).
   */
  @Post('assessment-imports/sessions/:sessionId/confirm')
  @RequirePermissions('health.assess')
  async confirmarSessao(
    @Param('sessionId') sessionId: string,
    @Body() corpo: unknown,
  ): Promise<{ assessmentId: string }> {
    const dados = esquemaDeConfirmacao.parse(corpo);

    return this.importacoes.confirmarSessao(
      this.contexto.require(),
      sessionId,
      this.exigirAtor(),
      new Date(dados.assessedAt),
      new Date(),
    );
  }

  @Get('assessment-imports/:id')
  @RequirePermissions('health.read')
  async detalhar(@Param('id') importId: string): Promise<ImportacaoDto> {
    const importacao = await this.importacoes.detalhar(this.contexto.require(), importId);

    return {
      id: importacao.id,
      studentId: importacao.studentId,
      status: importacao.status,
      originalFilename: importacao.originalFilename,
      fileType: importacao.fileType,
      extractor: importacao.extractor,
      failureReason: importacao.failureReason,
      assessmentId: importacao.assessmentId,
      createdAt: importacao.createdAt.toISOString(),
      fields: importacao.campos.map((campo) => ({
        id: campo.id,
        type: campo.type,
        extractedValue: campo.extractedValue,
        extractedUnit: campo.extractedUnit,
        confidence: campo.confidence,
        sourceLocation: campo.sourceLocation,
        sourceLabel: campo.sourceLabel,
        state: campo.state,
        reviewedValue: campo.reviewedValue,
        reviewedUnit: campo.reviewedUnit,
      })),
    };
  }

  /** Decisao do avaliador sobre UM campo (`M3-FR-011`). */
  @Post('assessment-imports/:id/fields/:fieldId')
  @RequirePermissions('health.assess')
  async revisar(
    @Param('id') importId: string,
    @Param('fieldId') fieldId: string,
    @Body() corpo: unknown,
  ): Promise<{ ok: true }> {
    const dados = esquemaDeRevisao.parse(corpo);

    await this.importacoes.revisarCampo(this.contexto.require(), importId, fieldId, {
      state: dados.state,
      reviewedValue: dados.reviewedValue ?? null,
      reviewedUnit: dados.reviewedUnit ?? null,
    });

    return { ok: true };
  }

  /**
   * Confirma a revisao e cria a avaliacao (INV-103).
   *
   * Campo pendente responde 409 com o `fieldId` -- a tela leva o avaliador
   * direto ao que falta, em vez de dizer so "nao pode".
   */
  @Post('assessment-imports/:id/confirm')
  @RequirePermissions('health.assess')
  async confirmar(
    @Param('id') importId: string,
    @Body() corpo: unknown,
  ): Promise<{ assessmentId: string }> {
    const dados = esquemaDeConfirmacao.parse(corpo);

    return this.importacoes.confirmar(
      this.contexto.require(),
      importId,
      this.exigirAtor(),
      new Date(dados.assessedAt),
      new Date(),
    );
  }

  @Post('assessment-imports/:id/discard')
  @RequirePermissions('health.assess')
  async descartar(@Param('id') importId: string): Promise<{ ok: true }> {
    await this.importacoes.descartar(
      this.contexto.require(),
      importId,
      this.exigirAtor(),
      new Date(),
    );

    return { ok: true };
  }

  /**
   * O ator e obrigatorio em toda rota desta fatia.
   *
   * Quem envia e quem revisa precisam ter dono: `CONFIRMED` sem revisor e o
   * OCR publicando sozinho, e a constraint do banco recusa a linha.
   */
  private exigirAtor(): string {
    const ator = this.contexto.require().actorId;

    if (!ator) throw new BadRequestException({ code: 'ACTOR_REQUIRED' });

    return ator;
  }
}
