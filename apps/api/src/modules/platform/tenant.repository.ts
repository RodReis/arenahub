import { Injectable } from '@nestjs/common';
import type { Tenant } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';

export type TenantNaLista = Tenant & { _count: { gymUnits: number } };

/**
 * Acesso a tenants pelo ator de PLATAFORMA.
 *
 * Nao recebe `TenantContext` -- e a unica classe do projeto que legitimamente
 * le tenants sem filtro de tenant. Por isso ela vive no modulo `platform` e
 * so e alcancavel por rota `@PlatformRoute()`.
 */
@Injectable()
export class TenantRepository {
  constructor(private readonly db: PrismaService) {}

  async listar(): Promise<TenantNaLista[]> {
    return this.db.tenant.findMany({
      orderBy: { displayName: 'asc' },
      include: { _count: { select: { gymUnits: true } } },
    });
  }
}
