import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import type { HealthMeasurement } from '@arenahub/database';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { StudentRepository } from '../students/student.repository.js';
import { TAMANHO_MAXIMO_BYTES } from './domain/arquivo-de-importacao.js';
import { TIPOS_DE_SINAL_VITAL, validarSinalVital, type TipoDeSinalVital } from './domain/sinal-vital.js';
import { SinalVitalExtractor } from './provider/sinal-vital.extractor.js';
import { VitalRepository } from './vital.repository.js';

/** O arquivo como o `FileInterceptor` o entrega -- mesmo molde de `import.controller.ts`. */
interface ArquivoRecebido {
  readonly originalname: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
}

const esquemaDeRegistroManual = z
  .object({
    type: z.enum(TIPOS_DE_SINAL_VITAL as [TipoDeSinalVital, ...TipoDeSinalVital[]]),
    value: z.number().finite(),
    /** Exigido so quando `type = BLOOD_PRESSURE` -- ver `validarSinalVital`. */
    secondaryValue: z.number().finite().nullable().optional(),
    measuredAt: z.iso.datetime(),
  })
  .strict();

interface SinalVitalDto {
  id: string;
  studentId: string;
  type: string;
  value: number;
  secondaryValue: number | null;
  unit: string;
  measuredAt: string;
  source: string;
  recordedByUserId: string;
  deviceReport: Record<string, unknown> | null;
  deviceModel: string | null;
}

const ESQUEMA_DO_SINAL_VITAL = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    studentId: { type: 'string' },
    type: { type: 'string' },
    value: { type: 'number' },
    secondaryValue: { type: 'number', nullable: true },
    unit: { type: 'string' },
    measuredAt: { type: 'string', format: 'date-time' },
    source: { type: 'string' },
    recordedByUserId: { type: 'string' },
    deviceReport: { type: 'object', nullable: true },
    deviceModel: { type: 'string', nullable: true },
  },
} as const;

function paraDto(registro: HealthMeasurement): SinalVitalDto {
  return {
    id: registro.id,
    studentId: registro.studentId,
    type: registro.type,
    value: registro.value.toNumber(),
    secondaryValue: registro.secondaryValue?.toNumber() ?? null,
    unit: registro.unit,
    measuredAt: registro.measuredAt.toISOString(),
    source: registro.source,
    recordedByUserId: registro.recordedByUserId,
    deviceReport: (registro.deviceReport as Record<string, unknown> | null) ?? null,
    deviceModel: registro.deviceModel,
  };
}

/**
 * Sinal vital avulso do aluno -- pressao, saturacao, FC de repouso.
 *
 * Card #345 (decisao do PI): STANDALONE de `BodyAssessment`/F17 -- sem
 * draft/publish/correction, e leitura pontual do balcao ou do PDF do
 * aparelho.
 *
 * Rotas:
 *
 *     GET  /api/v1/students/:id/vitals
 *     POST /api/v1/students/:id/vitals            (registro manual, JSON)
 *     POST /api/v1/students/:id/vitals/import      (PDF, multipart/form-data)
 */
@Controller('api/v1')
export class VitalController {
  constructor(
    private readonly vitais: VitalRepository,
    private readonly alunos: StudentRepository,
    private readonly extrator: SinalVitalExtractor,
    private readonly contexto: TenantContextService,
  ) {}

  @Get('students/:id/vitals')
  @RequirePermissions('health.read')
  @ApiOkResponse({ schema: { type: 'array', items: ESQUEMA_DO_SINAL_VITAL } })
  async listar(@Param('id') studentId: string): Promise<SinalVitalDto[]> {
    const contexto = this.contexto.require();

    await this.exigirAluno(studentId);

    const registros = await this.vitais.listarDoAluno(contexto, studentId);

    return registros.map(paraDto);
  }

  @Post('students/:id/vitals')
  @RequirePermissions('health.assess')
  @ApiCreatedResponse({ schema: ESQUEMA_DO_SINAL_VITAL })
  async registrar(@Param('id') studentId: string, @Body() corpo: unknown): Promise<SinalVitalDto> {
    const dados = esquemaDeRegistroManual.parse(corpo);
    const contexto = this.contexto.require();

    await this.exigirAluno(studentId);

    const sinal = validarSinalVital({
      type: dados.type,
      value: dados.value,
      secondaryValue: dados.secondaryValue ?? null,
    });

    const registro = await this.vitais.registrar(contexto, studentId, {
      measuredAt: new Date(dados.measuredAt),
      recordedByUserId: contexto.actorId,
      sinal,
      source: 'MANUAL',
    });

    return paraDto(registro);
  }

  /**
   * PDF do aparelho (ESCOPO DESTA ENTREGA: so ECG/FC de repouso -- ver
   * `SinalVitalExtractor`). `measuredAt` chega SEPARADO porque o PDF nao traz
   * data em formato que `Date` do JS analisa -- mesma razao do
   * `assessedAt` explicito na F19.
   */
  @Post('students/:id/vitals/import')
  @RequirePermissions('health.assess')
  @ApiCreatedResponse({ schema: ESQUEMA_DO_SINAL_VITAL })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TAMANHO_MAXIMO_BYTES } }))
  async importarDePdf(
    @Param('id') studentId: string,
    @UploadedFile() arquivo: ArquivoRecebido | undefined,
    @Body() corpo: unknown,
  ): Promise<SinalVitalDto> {
    const { measuredAt } = z.object({ measuredAt: z.iso.datetime() }).strict().parse(corpo);
    const contexto = this.contexto.require();

    await this.exigirAluno(studentId);

    if (!arquivo) {
      throw new NotFoundException({ code: 'HEALTH_VITAL_FILE_REQUIRED' });
    }

    const extraido = await this.extrator.extrairDePdf(new Uint8Array(arquivo.buffer));

    const sinal = validarSinalVital({ type: extraido.type, value: extraido.value });

    const registro = await this.vitais.registrar(contexto, studentId, {
      measuredAt: new Date(measuredAt),
      recordedByUserId: contexto.actorId,
      sinal,
      source: 'IMPORT',
      deviceReport: extraido.deviceReport,
      deviceModel: 'ALIVECOR_ECG',
    });

    return paraDto(registro);
  }

  private async exigirAluno(studentId: string): Promise<void> {
    const aluno = await this.alunos.encontrar(this.contexto.require(), studentId);

    if (!aluno) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
  }
}
