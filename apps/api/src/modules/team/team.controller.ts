import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Query, Req, Res } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { TeamRepository, type MembroDeTimeRow, type AgendaDoProfessorRow } from './team.repository.js';

/** DTO de saida -- nunca a linha do repositorio. */
interface MembroDeTimeDto {
  id: string;
  membershipNumber: string;
  fullName: string;
  profile: string;
  gymUnitId: string;
  employmentType: string | null;
  employmentStartedAt: string | null;
  version: number;
}

interface AgendaDoProfessorDto {
  classId: string;
  modalityId: string;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  gymUnitId: string;
}

/** Schema OpenAPI de `MembroDeTimeDto` -- reaproveitado nas quatro rotas. */
const SCHEMA_MEMBRO_DE_TIME = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' },
    membershipNumber: { type: 'string' },
    fullName: { type: 'string' },
    profile: { type: 'string' },
    gymUnitId: { type: 'string' },
    employmentType: { type: 'string', nullable: true },
    employmentStartedAt: { type: 'string', nullable: true },
    version: { type: 'number' },
  },
};

const esquemaDeVinculo = z
  .object({
    employmentType: z.enum(['CLT', 'PJ', 'AUTONOMOUS']).nullable().optional(),
    employmentStartedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    version: z.number().int().min(0),
  })
  .strict();

const esquemaDePerfil = z
  .object({
    profile: z.enum(['ADMIN', 'STUDENT', 'STAFF', 'TRAINER']),
    version: z.number().int().min(0),
  })
  .strict();

/**
 * Expoe `TeamRepository` como API REST -- F81 (issue #415).
 *
 * Time = `Student` com `profile != STUDENT`. O repositorio ja isola tenant e
 * filtro; este controller so traduz HTTP <-> repositorio, no mesmo padrao de
 * `StudentsController`.
 */
@Controller('api/v1/team')
export class TeamController {
  constructor(
    private readonly time: TeamRepository,
    private readonly contexto: TenantContextService,
  ) {}

  private paraDto(membro: MembroDeTimeRow): MembroDeTimeDto {
    return {
      id: membro.id,
      membershipNumber: membro.membershipNumber,
      fullName: membro.fullName,
      profile: membro.profile,
      gymUnitId: membro.gymUnitId,
      employmentType: membro.employmentType,
      employmentStartedAt: membro.employmentStartedAt?.toISOString().slice(0, 10) ?? null,
      version: membro.version,
    };
  }

  private paraAgendaDto(linha: AgendaDoProfessorRow): AgendaDoProfessorDto {
    return {
      classId: linha.classId,
      modalityId: linha.modalityId,
      dayOfWeek: linha.dayOfWeek,
      startMinute: linha.startMinute,
      durationMinutes: linha.durationMinutes,
      gymUnitId: linha.gymUnitId,
    };
  }

  /**
   * O TOTAL vai no CABECALHO `X-Total-Count`, mesmo padrao de
   * `StudentsController.buscar` -- e metadado da resposta, nao dado do
   * membro.
   */
  @Get()
  @RequirePermissions('team.read')
  @ApiOkResponse({ schema: { type: 'array', items: SCHEMA_MEMBRO_DE_TIME } })
  async buscar(
    @Res({ passthrough: true }) resposta: Response,
    @Query('q') termo?: string,
    @Query('limit') limite?: string,
    @Query('cursor') cursor?: string,
  ): Promise<MembroDeTimeDto[]> {
    const take = Math.min(Number(limite) || 20, 100);
    const contexto = this.contexto.require();

    const membros = await this.time.buscar(contexto, { termo, limite: take, cursor });
    const total = await this.time.contar(contexto, { termo });

    resposta.setHeader('X-Total-Count', String(total));
    resposta.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');

    return membros.map((m) => this.paraDto(m));
  }

  @Get(':id')
  @RequirePermissions('team.read')
  @ApiOkResponse({ schema: SCHEMA_MEMBRO_DE_TIME })
  async encontrar(@Param('id') id: string): Promise<MembroDeTimeDto> {
    const membro = await this.time.encontrar(this.contexto.require(), id);
    if (!membro) throw new NotFoundException({ code: 'TEAM_MEMBER_NOT_FOUND' });
    return this.paraDto(membro);
  }

  @Get(':id/agenda')
  @RequirePermissions('team.read')
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          classId: { type: 'string' },
          modalityId: { type: 'string' },
          dayOfWeek: { type: 'number' },
          startMinute: { type: 'number' },
          durationMinutes: { type: 'number' },
          gymUnitId: { type: 'string' },
        },
      },
    },
  })
  async agenda(@Param('id') id: string): Promise<AgendaDoProfessorDto[]> {
    const contexto = this.contexto.require();
    const membro = await this.time.encontrar(contexto, id);
    if (!membro) throw new NotFoundException({ code: 'TEAM_MEMBER_NOT_FOUND' });

    const linhas = await this.time.buscarAgenda(contexto, id);
    return linhas.map((l) => this.paraAgendaDto(l));
  }

  @Patch(':id/employment')
  @RequirePermissions('team.update')
  @ApiOkResponse({ schema: SCHEMA_MEMBRO_DE_TIME })
  async atualizarVinculo(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<MembroDeTimeDto> {
    const dados = esquemaDeVinculo.parse(corpo);
    const contexto = this.contexto.require();

    const atualizado = await this.time.atualizarVinculo(
      contexto,
      id,
      dados.version,
      {
        ...(dados.employmentType !== undefined ? { employmentType: dados.employmentType } : {}),
        ...(dados.employmentStartedAt !== undefined
          ? { employmentStartedAt: dados.employmentStartedAt ? new Date(dados.employmentStartedAt) : null }
          : {}),
      },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    if (!atualizado) {
      const existe = await this.time.encontrar(contexto, id);
      if (!existe) throw new NotFoundException({ code: 'TEAM_MEMBER_NOT_FOUND' });
      // Existe mas nao atualizou: so pode ser conflito de versao.
      throw new ConflictException({ code: 'STALE_VERSION' });
    }

    return this.paraDto(atualizado);
  }

  /**
   * Troca de profile -- F82. Move a pessoa entre aluno e time (ou entre
   * papeis do time). Mesma trava otimista de `/employment`.
   */
  @Patch(':id/profile')
  @RequirePermissions('team.update')
  @ApiOkResponse({ schema: SCHEMA_MEMBRO_DE_TIME })
  async alterarPerfil(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<MembroDeTimeDto> {
    const dados = esquemaDePerfil.parse(corpo);
    const contexto = this.contexto.require();

    const atualizado = await this.time.alterarPerfil(
      contexto,
      id,
      dados.version,
      dados.profile,
      requisicao.correlationId ?? 'sem-correlacao',
      new Date(),
    );

    if (!atualizado) {
      const existe = await this.time.existe(contexto, id);
      if (!existe) throw new NotFoundException({ code: 'TEAM_MEMBER_NOT_FOUND' });
      throw new ConflictException({ code: 'STALE_VERSION' });
    }

    return this.paraDto(atualizado);
  }
}
