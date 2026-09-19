import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { ClassReservationController } from './class-reservation.controller.js';
import { ClassReservationRepository } from './class-reservation.repository.js';

/**
 * Reserva, cancelamento e presenca -- F78 (SPEC-078, ADR-061).
 */
@Module({
  controllers: [ClassReservationController],
  providers: [ClassReservationRepository, TenantContextService],
})
export class ClassReservationsModule {}
