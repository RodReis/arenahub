import { Injectable } from '@nestjs/common';
import type { EmploymentType, StudentProfile } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

/** Linha de leitura de time (TRAINER/STAFF/ADMIN) -- F81, issue #415. */
export interface MembroDeTimeRow {
  id: string;
  membershipNumber: string;
  fullName: string;
  profile: Exclude<StudentProfile, 'STUDENT'>;
  gymUnitId: string;
  employmentType: EmploymentType | null;
  employmentStartedAt: Date | null;
  archivedAt: Date | null;
  version: number;
}

/**
 * Le a MESMA tabela `students`, com o filtro invertido -- F81 (issue #415).
 *
 * NAO E ENTIDADE NOVA: professor, staff e admin ja sao `Student` com
 * `profile != STUDENT` desde a F48 (ADR-061 decisao 5, para o caso do
 * professor). Este repository existe para dar uma PORTA DE LEITURA propria
 * a quem quer o time, em vez de todo consumidor montar `profile: { not:
 * 'STUDENT' }` por conta propria.
 */
@Injectable()
export class TeamRepository {
  constructor(private readonly db: PrismaService) {}

  async buscar(
    contexto: TenantContext,
    filtro: { termo?: string | undefined; limite: number; cursor?: string | undefined },
  ): Promise<MembroDeTimeRow[]> {
    return this.db.comTenant((tx) =>
      tx.student.findMany({
        where: {
          tenantId: contexto.tenantId,
          profile: { not: 'STUDENT' },
          ...(filtro.termo ? { fullName: { contains: filtro.termo, mode: 'insensitive' } } : {}),
        },
        select: {
          id: true,
          membershipNumber: true,
          fullName: true,
          profile: true,
          gymUnitId: true,
          employmentType: true,
          employmentStartedAt: true,
          archivedAt: true,
          version: true,
        },
        orderBy: { fullName: 'asc' },
        take: filtro.limite,
        ...(filtro.cursor ? { skip: 1, cursor: { id: filtro.cursor } } : {}),
      }),
    ) as Promise<MembroDeTimeRow[]>;
  }

  async contar(contexto: TenantContext, filtro: { termo?: string | undefined }): Promise<number> {
    return this.db.comTenant((tx) =>
      tx.student.count({
        where: {
          tenantId: contexto.tenantId,
          profile: { not: 'STUDENT' },
          ...(filtro.termo ? { fullName: { contains: filtro.termo, mode: 'insensitive' } } : {}),
        },
      }),
    );
  }

  async encontrar(contexto: TenantContext, id: string): Promise<MembroDeTimeRow | null> {
    return this.db.comTenant((tx) =>
      tx.student.findFirst({
        where: { id, tenantId: contexto.tenantId, profile: { not: 'STUDENT' } },
        select: {
          id: true,
          membershipNumber: true,
          fullName: true,
          profile: true,
          gymUnitId: true,
          employmentType: true,
          employmentStartedAt: true,
          archivedAt: true,
          version: true,
        },
      }),
    ) as Promise<MembroDeTimeRow | null>;
  }

  /**
   * Grava vinculo trabalhista -- F81. Mesmo padrao de
   * `StudentRepository.atualizar`: trava otimista por `version`, timeline,
   * auditLog e outbox na MESMA transacao (regras de arquitetura 4 e 5).
   *
   * Devolve `null` quando o id nao existe neste tenant, quando pertence a
   * `profile = STUDENT` (nao e "time"), ou quando `versaoEsperada` nao bate
   * com a versao gravada -- os tres casos sao "nao atualizei", e quem chama
   * decide o HTTP certo para cada um.
   */
  async atualizarVinculo(
    contexto: TenantContext,
    id: string,
    versaoEsperada: number,
    dados: { employmentType?: EmploymentType | null; employmentStartedAt?: Date | null },
    correlationId: string,
  ): Promise<MembroDeTimeRow | null> {
    return this.db.$transaction(async (tx) => {
      const alterados = await tx.student.updateMany({
        where: { id, tenantId: contexto.tenantId, version: versaoEsperada, profile: { not: 'STUDENT' } },
        data: {
          version: { increment: 1 },
          ...(dados.employmentType !== undefined ? { employmentType: dados.employmentType } : {}),
          ...(dados.employmentStartedAt !== undefined
            ? { employmentStartedAt: dados.employmentStartedAt }
            : {}),
        },
      });

      if (alterados.count === 0) return null;

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: id,
          type: 'STUDENT_UPDATED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          payload: { campos: Object.keys(dados) },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'team.employment_updated',
          target: 'student',
          targetId: id,
          correlationId,
          metadata: { campos: Object.keys(dados) },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'StudentUpdated',
          aggregateType: 'Student',
          aggregateId: id,
          payload: { studentId: id },
        },
      });

      return tx.student.findFirst({
        where: { id, tenantId: contexto.tenantId },
        select: {
          id: true,
          membershipNumber: true,
          fullName: true,
          profile: true,
          gymUnitId: true,
          employmentType: true,
          employmentStartedAt: true,
          archivedAt: true,
          version: true,
        },
      }) as Promise<MembroDeTimeRow | null>;
    });
  }
}
