import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { AvisoAGravar } from './domain/mapa-de-avisos.js';
import type { PortaDeAvisos } from './notifications-inbox.repository.js';

/** `aggregateType` do OutboxEvent -> como achar o `studentId` dono do fato. */
type Resolvedor = (db: PrismaService, aggregateId: string) => Promise<string | null>;

const RESOLVEDORES: Record<string, Resolvedor> = {
  Invoice: async (db, id) => {
    const invoice = await db.invoice.findUnique({ where: { id }, select: { studentId: true } });

    return invoice?.studentId ?? null;
  },
  Subscription: async (db, id) => {
    const subscription = await db.subscription.findUnique({
      where: { id },
      select: { studentId: true },
    });

    return subscription?.studentId ?? null;
  },
  BodyAssessment: async (db, id) => {
    const assessment = await db.bodyAssessment.findUnique({
      where: { id },
      select: { studentId: true },
    });

    return assessment?.studentId ?? null;
  },
};

/**
 * `student_notifications` NAO tem politica RLS (F29 deliberadamente a
 * deixou de fora -- ver o comentario de `MobileAvisosService`), entao
 * `this.db` direto e correto aqui.
 */
@Injectable()
export class NotificationsInboxRepository implements PortaDeAvisos {
  constructor(private readonly db: PrismaService) {}

  async resolverStudentId(aggregateType: string, aggregateId: string): Promise<string | null> {
    const resolvedor = RESOLVEDORES[aggregateType];
    if (resolvedor === undefined) return null;

    return resolvedor(this.db, aggregateId);
  }

  async gravar(tenantId: string, studentId: string, aviso: AvisoAGravar): Promise<void> {
    await this.db.studentNotification.create({
      data: {
        tenantId,
        studentId,
        kind: aviso.kind,
        title: aviso.title,
        body: aviso.body,
        action: aviso.action,
        actionTargetId: aviso.actionTargetId,
        expiresAt: aviso.expiresAt,
      },
    });
  }
}
