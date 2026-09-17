import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';

export const PORTA_DE_UNIDADES_DE_RETENCAO = Symbol('PortaDeUnidadesDeRetencao');

/** Uma unidade ativa, para o job decidir o fuso do dia civil a fechar. */
export interface UnidadeParaRetencao {
  readonly tenantId: string;
  readonly gymUnitId: string;
  readonly timezone: string;
}

/**
 * EXCECAO: nao recebe `TenantContext` -- varredura entre TODOS os tenants,
 * mesmo padrao de `PortaDeRanking.unidadesAtivasComTimezone` (F35) e de
 * `OperationsRepository.listarTenantsAtivos` (F11): quem chama e um JOB de
 * sistema, sem ator autenticado de tenant nenhum.
 */
export interface PortaDeUnidadesDeRetencao {
  unidadesAtivasComTimezone(): Promise<readonly UnidadeParaRetencao[]>;
}

@Injectable()
export class RetentionSchedulerRepository implements PortaDeUnidadesDeRetencao {
  constructor(private readonly db: PrismaService) {}

  async unidadesAtivasComTimezone(): Promise<readonly UnidadeParaRetencao[]> {
    const unidades = await this.db.gymUnit.findMany({
      where: { tenant: { status: 'ACTIVE' } },
      select: { tenantId: true, id: true, timezone: true },
    });

    return unidades.map((unidade) => ({
      tenantId: unidade.tenantId,
      gymUnitId: unidade.id,
      timezone: unidade.timezone,
    }));
  }
}
