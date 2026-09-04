import { Injectable } from '@nestjs/common';
import type { GymUnitModality } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * Acesso a modalidades de uma unidade -- F60.
 *
 * TODO METODO recebe `TenantContext` como PRIMEIRO argumento, como o
 * `GymUnitRepository` ao lado: INV-003 e regra de arquitetura no 2.
 *
 * MODALIDADE E ROTULO, NAO CONTROLE DE ACESSO. Nada aqui e consultado pelo
 * motor de decisao -- quem decide se a catraca abre continua sendo o plano
 * (regra de arquitetura no 1).
 */
@Injectable()
export class GymUnitModalityRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * `apenasAtivas` existe porque as duas telas querem coisas diferentes: o
   * cadastro de aluno so pode oferecer o que esta em operacao, e a tela de
   * administracao precisa ver a inativa para poder reativa-la.
   */
  async listar(
    contexto: TenantContext,
    gymUnitId: string,
    apenasAtivas = false,
  ): Promise<GymUnitModality[]> {
    return this.db.gymUnitModality.findMany({
      where: {
        tenantId: contexto.tenantId,
        gymUnitId,
        ...(apenasAtivas ? { isActive: true } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Modalidades ATIVAS de todas as unidades do tenant, numa consulta so.
   *
   * O wizard de cadastro precisa da lista inteira de uma vez: ele filtra por
   * unidade no cliente conforme a operadora troca o select, e uma chamada por
   * unidade faria a tela ir ao servidor a cada troca.
   */
  async listarDoTenant(contexto: TenantContext): Promise<GymUnitModality[]> {
    return this.db.gymUnitModality.findMany({
      where: { tenantId: contexto.tenantId, isActive: true },
      orderBy: [{ gymUnitId: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Devolve as modalidades encontradas DENTRO da unidade informada.
   *
   * Quem chama compara o tamanho com o que pediu: id de outra unidade, de
   * outro tenant ou inexistente simplesmente nao volta, e a diferenca de
   * contagem e a recusa. Uma consulta so, e nao uma por id.
   */
  async encontrarNaUnidade(
    contexto: TenantContext,
    gymUnitId: string,
    ids: readonly string[],
  ): Promise<GymUnitModality[]> {
    if (ids.length === 0) return [];

    return this.db.gymUnitModality.findMany({
      where: { tenantId: contexto.tenantId, gymUnitId, id: { in: [...ids] } },
    });
  }

  async criar(
    contexto: TenantContext,
    gymUnitId: string,
    name: string,
    correlationId: string,
  ): Promise<GymUnitModality> {
    return this.db.$transaction(async (tx) => {
      const modalidade = await tx.gymUnitModality.create({
        data: { tenantId: contexto.tenantId, gymUnitId, name },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'unit.modality.created',
          target: 'gym_unit_modality',
          targetId: modalidade.id,
          correlationId,
          // Nome de modalidade e dado operacional, nao pessoal.
          metadata: { name },
        },
      });

      return modalidade;
    });
  }

  /**
   * `updateMany` com `tenantId` no filtro, e nao `update` por id -- mesmo
   * motivo do `GymUnitRepository`: id de outro tenant nao entra no conjunto,
   * em vez de ser encontrado e so depois recusado.
   */
  async atualizar(
    contexto: TenantContext,
    gymUnitId: string,
    id: string,
    dados: { name?: string | undefined; isActive?: boolean | undefined },
    correlationId: string,
  ): Promise<GymUnitModality | null> {
    const alteracoes = Object.fromEntries(
      Object.entries(dados).filter(([, valor]) => valor !== undefined),
    );

    return this.db.$transaction(async (tx) => {
      const alterados = await tx.gymUnitModality.updateMany({
        where: { id, gymUnitId, tenantId: contexto.tenantId },
        data: alteracoes,
      });

      if (alterados.count === 0) return null;

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'unit.modality.updated',
          target: 'gym_unit_modality',
          targetId: id,
          correlationId,
          metadata: { campos: Object.keys(alteracoes) },
        },
      });

      return tx.gymUnitModality.findFirstOrThrow({
        where: { id, tenantId: contexto.tenantId },
      });
    });
  }
}
