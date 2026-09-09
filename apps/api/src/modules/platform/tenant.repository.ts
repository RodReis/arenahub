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

  /**
   * Um tenant, com os campos cadastrais que a lista omite.
   *
   * `listar()` e visao de painel e nao carrega `cnpj` nem `responsavelEmail`,
   * de proposito. Um formulario de edicao alimentado por ela nasceria com
   * esses campos em branco -- e salvar apagaria dado que ninguem pediu para
   * apagar.
   *
   * Devolve `null` em vez de lancar: quem decide se e 404 e o controller, que
   * e onde a forma da resposta HTTP mora.
   */
  async porId(id: string): Promise<TenantNaLista | null> {
    return this.db.tenant.findUnique({
      where: { id },
      include: { _count: { select: { gymUnits: true } } },
    });
  }
}
