import { Injectable } from '@nestjs/common';
import type { ClassAttendance, ClassReservation } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { AulaNaoEncontradaError } from '../classes/class.repository.js';
import { resolverOcorrencia } from '../classes/domain/class.js';
import {
  AlunoSemAssinaturaAtivaError,
  AulaLotadaError,
  AulaNaoInclusaNoPlanoError,
  OcorrenciaCanceladaError,
} from './class-reservation.errors.js';
import { modalidadeAutorizada } from './domain/entitlement.js';

export interface DadosDeReserva {
  classId: string;
  studentId: string;
  occurrenceDate: Date;
  overriddenById?: string | undefined;
}

export interface DadosDePresenca {
  classId: string;
  occurrenceDate: Date;
  presentStudentIds: string[];
  markedById: string;
}

/**
 * Reserva, cancelamento e presenca -- F78 (SPEC-078, ADR-061).
 *
 * NAO CONSULTADO PELO MOTOR DE ACESSO -- ADR-061 decisao no 2, mesmo
 * principio de `ClassRepository`.
 */
@Injectable()
export class ClassReservationRepository {
  constructor(private readonly db: PrismaService) {}

  async reservar(
    contexto: TenantContext,
    entrada: DadosDeReserva,
    correlationId: string,
  ): Promise<ClassReservation> {
    const aula = await this.db.class.findFirst({
      where: { id: entrada.classId, tenantId: contexto.tenantId },
    });
    if (!aula) throw new AulaNaoEncontradaError();

    const excecoes = await this.db.classException.findMany({
      where: { tenantId: contexto.tenantId, classId: entrada.classId },
    });

    const ocorrencia = resolverOcorrencia(aula.trainerId, entrada.occurrenceDate, excecoes);
    if (!ocorrencia.ocorre) throw new OcorrenciaCanceladaError();

    if (!entrada.overriddenById) {
      await this.validarEntitlement(contexto, entrada.studentId, aula.modalityId);
    }

    return this.db.$transaction(async (tx) => {
      const ativas = await tx.classReservation.count({
        where: {
          tenantId: contexto.tenantId,
          classId: entrada.classId,
          occurrenceDate: entrada.occurrenceDate,
          status: 'RESERVED',
        },
      });
      if (ativas >= aula.capacity) throw new AulaLotadaError();

      const existente = await tx.classReservation.findUnique({
        where: {
          classId_occurrenceDate_studentId: {
            classId: entrada.classId,
            occurrenceDate: entrada.occurrenceDate,
            studentId: entrada.studentId,
          },
        },
      });

      const dadosComuns = {
        status: 'RESERVED' as const,
        overriddenById: entrada.overriddenById ?? null,
        overriddenAt: entrada.overriddenById ? new Date() : null,
        cancelledById: null,
        cancelledAt: null,
      };

      const reserva = existente
        ? await tx.classReservation.update({ where: { id: existente.id }, data: dadosComuns })
        : await tx.classReservation.create({
            data: {
              tenantId: contexto.tenantId,
              classId: entrada.classId,
              studentId: entrada.studentId,
              occurrenceDate: entrada.occurrenceDate,
              ...dadosComuns,
            },
          });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: aula.gymUnitId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'class_reservation.created',
          target: 'class_reservation',
          targetId: reserva.id,
          correlationId,
          metadata: { classId: entrada.classId, overridden: Boolean(entrada.overriddenById) },
        },
      });

      return reserva;
    });
  }

  async cancelar(
    contexto: TenantContext,
    reservationId: string,
    cancelledById: string,
    correlationId: string,
  ): Promise<ClassReservation | null> {
    return this.db.$transaction(async (tx) => {
      const alterados = await tx.classReservation.updateMany({
        where: { id: reservationId, tenantId: contexto.tenantId, status: 'RESERVED' },
        data: { status: 'CANCELLED', cancelledById, cancelledAt: new Date() },
      });

      // Idempotente: se ja estava CANCELLED, `alterados.count` e 0, mas a
      // linha existe -- devolve o estado atual em vez de 404.
      const atual = await tx.classReservation.findFirst({
        where: { id: reservationId, tenantId: contexto.tenantId },
      });
      if (!atual) return null;

      if (alterados.count > 0) {
        await tx.auditLog.create({
          data: {
            tenantId: contexto.tenantId,
            actorType: 'USER',
            actorId: contexto.actorId,
            action: 'class_reservation.cancelled',
            target: 'class_reservation',
            targetId: reservationId,
            correlationId,
            metadata: {},
          },
        });
      }

      return atual;
    });
  }

  async listarPorOcorrencia(
    contexto: TenantContext,
    classId: string,
    occurrenceDate: Date,
  ): Promise<ClassReservation[]> {
    return this.db.classReservation.findMany({
      where: { tenantId: contexto.tenantId, classId, occurrenceDate },
      orderBy: { createdAt: 'asc' },
    });
  }

  async marcarPresenca(
    contexto: TenantContext,
    entrada: DadosDePresenca,
    correlationId: string,
  ): Promise<ClassAttendance[]> {
    return this.db.$transaction(async (tx) => {
      const reservas = await tx.classReservation.findMany({
        where: {
          tenantId: contexto.tenantId,
          classId: entrada.classId,
          occurrenceDate: entrada.occurrenceDate,
          status: 'RESERVED',
        },
      });

      const presentes = new Set(entrada.presentStudentIds);
      const registros: ClassAttendance[] = [];

      for (const reserva of reservas) {
        const status = presentes.has(reserva.studentId) ? 'PRESENT' : 'NO_SHOW';

        const registro = await tx.classAttendance.upsert({
          where: { reservationId: reserva.id },
          create: {
            tenantId: contexto.tenantId,
            reservationId: reserva.id,
            status,
            markedById: entrada.markedById,
          },
          update: { status, markedById: entrada.markedById, markedAt: new Date() },
        });

        registros.push(registro);
      }

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'class_attendance.marked',
          target: 'class',
          targetId: entrada.classId,
          correlationId,
          metadata: { occurrenceDate: entrada.occurrenceDate.toISOString().slice(0, 10) },
        },
      });

      return registros;
    });
  }

  /**
   * `comTenant`: `students`/`subscriptions` tem politica RLS -- mesma
   * armadilha das issues #302/#306 ja documentada em `ClassRepository`.
   */
  private async validarEntitlement(
    contexto: TenantContext,
    studentId: string,
    modalityId: string,
  ): Promise<void> {
    const assinatura = await this.db.comTenant((tx) =>
      tx.subscription.findFirst({
        where: { studentId, tenantId: contexto.tenantId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
        orderBy: { startsAt: 'desc' },
        select: { planId: true },
      }),
    );
    if (!assinatura) throw new AlunoSemAssinaturaAtivaError();

    const entitlements = await this.db.planClassEntitlement.findMany({
      where: { tenantId: contexto.tenantId, planId: assinatura.planId },
      select: { modalityId: true },
    });

    const autorizado = modalidadeAutorizada(
      entitlements.map((e) => e.modalityId),
      modalityId,
    );
    if (!autorizado) throw new AulaNaoInclusaNoPlanoError();
  }
}
