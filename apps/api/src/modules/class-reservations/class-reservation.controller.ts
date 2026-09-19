import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { ClassAttendance, ClassReservation } from '@arenahub/database';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { ClassReservationRepository } from './class-reservation.repository.js';

const esquemaDeReserva = z
  .object({
    studentId: z.uuid(),
    occurrenceDate: z.iso.date(),
    /** Presenca da recepcao liberando fora do plano -- ADR-061 decisao no 8. */
    overriddenById: z.uuid().optional(),
  })
  .strict();

const esquemaDePresenca = z
  .object({
    occurrenceDate: z.iso.date(),
    presentStudentIds: z.array(z.uuid()),
  })
  .strict();

function paraData(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const ESQUEMA_DA_RESERVA = {
  type: 'object',
  required: [
    'id',
    'classId',
    'studentId',
    'occurrenceDate',
    'status',
    'overriddenById',
    'cancelledById',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    classId: { type: 'string', format: 'uuid' },
    studentId: { type: 'string', format: 'uuid' },
    occurrenceDate: { type: 'string', format: 'date' },
    status: { type: 'string', enum: ['RESERVED', 'CANCELLED'] },
    overriddenById: { type: 'string', format: 'uuid', nullable: true },
    cancelledById: { type: 'string', format: 'uuid', nullable: true },
  },
};

const ESQUEMA_DA_LISTA_DE_RESERVAS = { type: 'array', items: ESQUEMA_DA_RESERVA };

const ESQUEMA_DA_PRESENCA = {
  type: 'object',
  required: ['reservationId', 'studentId', 'status'],
  properties: {
    reservationId: { type: 'string', format: 'uuid' },
    studentId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['PRESENT', 'NO_SHOW'] },
  },
};

const ESQUEMA_DA_LISTA_DE_PRESENCAS = { type: 'array', items: ESQUEMA_DA_PRESENCA };

interface ReservaDto {
  id: string;
  classId: string;
  studentId: string;
  occurrenceDate: string;
  status: string;
  overriddenById: string | null;
  cancelledById: string | null;
}

interface PresencaDto {
  reservationId: string;
  studentId: string;
  status: string;
}

/**
 * Reserva, cancelamento e presenca -- F78 (SPEC-078, ADR-061).
 *
 * ANINHADO EM `/units/:unitId/classes/:classId`, mesmo padrao de
 * `ClassController`.
 */
@Controller('api/v1/units')
export class ClassReservationController {
  constructor(
    private readonly reservas: ClassReservationRepository,
    private readonly contexto: TenantContextService,
  ) {}

  @Post(':unitId/classes/:classId/reservations')
  @RequirePermissions('class.manage')
  @ApiCreatedResponse({ description: 'Reserva criada', schema: ESQUEMA_DA_RESERVA })
  async reservar(
    @Param('classId') classId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<ReservaDto> {
    const dados = esquemaDeReserva.parse(corpo);

    const reserva = await this.reservas.reservar(
      this.contexto.require(),
      {
        classId,
        studentId: dados.studentId,
        occurrenceDate: paraData(dados.occurrenceDate),
        overriddenById: dados.overriddenById,
      },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return this.paraDto(reserva);
  }

  @Patch(':unitId/classes/:classId/reservations/:reservationId/cancel')
  @RequirePermissions('class.manage')
  @ApiOkResponse({ description: 'Reserva cancelada', schema: ESQUEMA_DA_RESERVA })
  async cancelar(
    @Param('reservationId') reservationId: string,
    @Req() requisicao: Request,
  ): Promise<ReservaDto> {
    const contexto = this.contexto.require();
    const reserva = await this.reservas.cancelar(
      contexto,
      reservationId,
      contexto.actorId,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    if (!reserva) throw new NotFoundException({ code: 'CLASS_RESERVATION_NOT_FOUND' });

    return this.paraDto(reserva);
  }

  @Get(':unitId/classes/:classId/reservations')
  @RequirePermissions('class.read')
  @ApiOkResponse({ description: 'Reservas da ocorrencia', schema: ESQUEMA_DA_LISTA_DE_RESERVAS })
  async listar(
    @Param('classId') classId: string,
    @Query('occurrenceDate') occurrenceDate: string,
  ): Promise<ReservaDto[]> {
    const encontradas = await this.reservas.listarPorOcorrencia(
      this.contexto.require(),
      classId,
      paraData(z.iso.date().parse(occurrenceDate)),
    );

    return encontradas.map((r) => this.paraDto(r));
  }

  @Post(':unitId/classes/:classId/attendance')
  @RequirePermissions('class.manage')
  @ApiCreatedResponse({ description: 'Presenca registrada', schema: ESQUEMA_DA_LISTA_DE_PRESENCAS })
  async marcarPresenca(
    @Param('classId') classId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<PresencaDto[]> {
    const dados = esquemaDePresenca.parse(corpo);
    const contexto = this.contexto.require();

    const registros = await this.reservas.marcarPresenca(
      contexto,
      {
        classId,
        occurrenceDate: paraData(dados.occurrenceDate),
        presentStudentIds: dados.presentStudentIds,
        markedById: contexto.actorId,
      },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    const reservasDaOcorrencia = await this.reservas.listarPorOcorrencia(
      contexto,
      classId,
      paraData(dados.occurrenceDate),
    );
    const reservaPorId = new Map(reservasDaOcorrencia.map((r) => [r.id, r]));

    return registros.map((registro: ClassAttendance) => ({
      reservationId: registro.reservationId,
      studentId: reservaPorId.get(registro.reservationId)?.studentId ?? '',
      status: registro.status,
    }));
  }

  private paraDto(reserva: ClassReservation): ReservaDto {
    return {
      id: reserva.id,
      classId: reserva.classId,
      studentId: reserva.studentId,
      occurrenceDate: reserva.occurrenceDate.toISOString().slice(0, 10),
      status: reserva.status,
      overriddenById: reserva.overriddenById,
      cancelledById: reserva.cancelledById,
    };
  }
}
