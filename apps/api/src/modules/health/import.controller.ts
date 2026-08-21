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

interface CampoDto {
  id: string;
  type: string;
  extractedValue: number | null;
  extractedUnit: string | null;
  confidence: number | null;
  sourceLocation: string | null;
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
  ): Promise<{ id: string; status: string; extractedFields: number; failureReason: string | null }> {
    if (!arquivo) {
      throw new BadRequestException({ code: 'FILE_REQUIRED' });
    }

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
    );

    return {
      id: resultado.id,
      status: resultado.status,
      extractedFields: resultado.camposExtraidos,
      failureReason: resultado.motivoDaFalha,
    };
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
