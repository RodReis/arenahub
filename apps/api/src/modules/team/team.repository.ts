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
}
