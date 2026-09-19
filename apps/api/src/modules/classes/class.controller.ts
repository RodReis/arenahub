import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Req } from '@nestjs/common';
import type { Class, ClassException } from '@arenahub/database';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { MINUTOS_POR_DIA } from '../membership/domain/plan.js';
import { ClassRepository } from './class.repository.js';

const esquemaDeCriacao = z
  .object({
    gymUnitId: z.uuid(),
    modalityId: z.uuid(),
    // Opcional -- decisao do PI, 18/09/2026: quadra alugada sem professor e
    // caso real (SPEC-077 3.1).
    trainerId: z.uuid().optional(),
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(MINUTOS_POR_DIA),
    durationMinutes: z.number().int().positive(),
    capacity: z.number().int().positive(),
  })
  .strict();

// `gymUnitId` NAO edita: aula muda de professor, horario, modalidade ou
// capacidade, mas nao muda de unidade -- trocar de unidade e outra aula.
const esquemaDeEdicao = z
  .object({
    modalityId: z.uuid(),
    trainerId: z.uuid().optional(),
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(MINUTOS_POR_DIA),
    durationMinutes: z.number().int().positive(),
    capacity: z.number().int().positive(),
  })
  .strict();

const esquemaDeAtivacao = z.object({ isActive: z.boolean() }).strict();

const esquemaDeExcecao = z
  .object({
    occurrenceDate: z.iso.date(),
    type: z.enum(['CANCELLED', 'TRAINER_OVERRIDE']),
    overrideTrainerId: z.uuid().optional(),
  })
  .strict()
  .refine((dados) => dados.type !== 'TRAINER_OVERRIDE' || dados.overrideTrainerId !== undefined, {
    message: 'overrideTrainerId e obrigatorio quando type e TRAINER_OVERRIDE',
  });

const ESQUEMA_DA_AULA = {
  type: 'object',
  required: [
    'id',
    'gymUnitId',
    'modalityId',
    'trainerId',
    'dayOfWeek',
    'startMinute',
    'durationMinutes',
    'capacity',
    'isActive',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    gymUnitId: { type: 'string', format: 'uuid' },
    modalityId: { type: 'string', format: 'uuid' },
    trainerId: { type: 'string', format: 'uuid', nullable: true },
    dayOfWeek: { type: 'integer' },
    startMinute: { type: 'integer' },
    durationMinutes: { type: 'integer' },
    capacity: { type: 'integer' },
    isActive: { type: 'boolean' },
  },
};

const ESQUEMA_DA_LISTA_DE_AULAS = { type: 'array', items: ESQUEMA_DA_AULA };

const ESQUEMA_DA_EXCECAO = {
  type: 'object',
  required: ['id', 'classId', 'occurrenceDate', 'type', 'overrideTrainerId'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    classId: { type: 'string', format: 'uuid' },
    occurrenceDate: { type: 'string', format: 'date' },
    type: { type: 'string', enum: ['CANCELLED', 'TRAINER_OVERRIDE'] },
    overrideTrainerId: { type: 'string', format: 'uuid', nullable: true },
  },
};

const ESQUEMA_DA_LISTA_DE_EXCECOES = { type: 'array', items: ESQUEMA_DA_EXCECAO };

interface AulaDto {
  id: string;
  gymUnitId: string;
  modalityId: string;
  trainerId: string | null;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  capacity: number;
  isActive: boolean;
}

interface ExcecaoDto {
  id: string;
  classId: string;
  occurrenceDate: string;
  type: 'CANCELLED' | 'TRAINER_OVERRIDE';
  overrideTrainerId: string | null;
}

/**
 * Agenda de aulas -- F77 (SPEC-077, ADR-061).
 *
 * ANINHADO EM `/units/:unitId`, mesmo padrao de `GymUnitModalityController`:
 * aula nao existe fora de uma unidade.
 */
@Controller('api/v1/units')
export class ClassController {
  constructor(
    private readonly aulas: ClassRepository,
    private readonly contexto: TenantContextService,
  ) {}

  @Get(':unitId/classes')
  @RequirePermissions('class.read')
  @ApiOkResponse({ schema: ESQUEMA_DA_LISTA_DE_AULAS })
  async listar(@Param('unitId') unitId: string): Promise<AulaDto[]> {
    const encontradas = await this.aulas.listar(this.contexto.require(), unitId);

    return encontradas.map((a) => this.paraDto(a));
  }

  @Post(':unitId/classes')
  @RequirePermissions('class.manage')
  @ApiCreatedResponse({ schema: ESQUEMA_DA_AULA })
  async criar(
    @Param('unitId') unitId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<AulaDto> {
    const dados = esquemaDeCriacao.parse(corpo);

    if (dados.gymUnitId !== unitId) {
      throw new NotFoundException({ code: 'UNIT_NOT_FOUND' });
    }

    const aula = await this.aulas.criar(
      this.contexto.require(),
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return this.paraDto(aula);
  }

  @Patch(':unitId/classes/:classId')
  @RequirePermissions('class.manage')
  @ApiOkResponse({ schema: ESQUEMA_DA_AULA })
  async editar(
    @Param('classId') classId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<AulaDto> {
    const dados = esquemaDeEdicao.parse(corpo);

    const aula = await this.aulas.editar(
      this.contexto.require(),
      classId,
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    if (!aula) throw new NotFoundException({ code: 'CLASS_NOT_FOUND' });

    return this.paraDto(aula);
  }

  @Patch(':unitId/classes/:classId/activation')
  @RequirePermissions('class.manage')
  @ApiOkResponse({ schema: ESQUEMA_DA_AULA })
  async alterarAtivacao(
    @Param('classId') classId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<AulaDto> {
    const dados = esquemaDeAtivacao.parse(corpo);

    const aula = await this.aulas.alterarAtivacao(
      this.contexto.require(),
      classId,
      dados.isActive,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    if (!aula) throw new NotFoundException({ code: 'CLASS_NOT_FOUND' });

    return this.paraDto(aula);
  }

  @Get(':unitId/classes/:classId/exceptions')
  @RequirePermissions('class.read')
  @ApiOkResponse({ schema: ESQUEMA_DA_LISTA_DE_EXCECOES })
  async listarExcecoes(@Param('classId') classId: string): Promise<ExcecaoDto[]> {
    const excecoes = await this.aulas.listarExcecoes(this.contexto.require(), classId);

    return excecoes.map((e) => this.excecaoParaDto(e));
  }

  /**
   * Cancela uma ocorrencia ou troca o professor de UM dia, sem desfazer a
   * grade (SPEC-077 §3, comportamento exigido).
   */
  @Post(':unitId/classes/:classId/exceptions')
  @RequirePermissions('class.manage')
  @ApiCreatedResponse({ schema: ESQUEMA_DA_EXCECAO })
  async registrarExcecao(
    @Param('classId') classId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<ExcecaoDto> {
    const dados = esquemaDeExcecao.parse(corpo);

    const excecao = await this.aulas.registrarExcecao(
      this.contexto.require(),
      {
        classId,
        occurrenceDate: new Date(`${dados.occurrenceDate}T00:00:00.000Z`),
        type: dados.type,
        overrideTrainerId: dados.overrideTrainerId,
      },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return this.excecaoParaDto(excecao);
  }

  private paraDto(aula: Class): AulaDto {
    return {
      id: aula.id,
      gymUnitId: aula.gymUnitId,
      modalityId: aula.modalityId,
      trainerId: aula.trainerId,
      dayOfWeek: aula.dayOfWeek,
      startMinute: aula.startMinute,
      durationMinutes: aula.durationMinutes,
      capacity: aula.capacity,
      isActive: aula.isActive,
    };
  }

  private excecaoParaDto(excecao: ClassException): ExcecaoDto {
    return {
      id: excecao.id,
      classId: excecao.classId,
      occurrenceDate: excecao.occurrenceDate.toISOString().slice(0, 10),
      type: excecao.type,
      overrideTrainerId: excecao.overrideTrainerId,
    };
  }
}
