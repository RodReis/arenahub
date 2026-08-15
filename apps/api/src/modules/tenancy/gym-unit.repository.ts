import { Injectable } from '@nestjs/common';
import type { GymUnit, Prisma } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * Acesso a unidades.
 *
 * TODO METODO recebe `TenantContext` como PRIMEIRO argumento -- INV-003 e
 * regra de arquitetura no 2. Nao e convencao de estilo: e o que faz o
 * `tenantId` ser impossivel de esquecer, porque sem ele o codigo nao
 * compila. Nenhum metodo aqui aceita `tenantId` solto.
 */
@Injectable()
export class GymUnitRepository {
  constructor(private readonly db: PrismaService) {}

  async listar(contexto: TenantContext): Promise<GymUnit[]> {
    return this.db.gymUnit.findMany({
      where: { tenantId: contexto.tenantId },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Devolve `null` -- e nao lanca 403 -- quando a unidade e de outro tenant.
   *
   * Quem chama traduz para 404. Distinguir "nao existe" de "existe mas nao e
   * seu" confirmaria ao atacante que ele acertou o UUID.
   */
  async encontrar(contexto: TenantContext, id: string): Promise<GymUnit | null> {
    return this.db.gymUnit.findFirst({ where: { id, tenantId: contexto.tenantId } });
  }

  /**
   * Cria a unidade, a trilha de auditoria e o evento de dominio NUMA
   * TRANSACAO SO (regra de arquitetura no 5).
   *
   * O outbox existe justamente porque publicar antes de commitar produz
   * evento de algo que nunca aconteceu -- e o consumidor nao tem como
   * desfazer o que ja processou.
   */
  async criar(
    contexto: TenantContext,
    dados: {
      code: string;
      name: string;
      timezone: string;
      openingHours: Prisma.InputJsonValue;
    },
    correlationId: string,
  ): Promise<GymUnit> {
    return this.db.$transaction(async (tx) => {
      const unidade = await tx.gymUnit.create({
        data: { ...dados, tenantId: contexto.tenantId },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: unidade.id,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'unit.created',
          target: 'gym_unit',
          targetId: unidade.id,
          correlationId,
          // Metadado sem PII: codigo e nome de unidade sao dado
          // operacional, nao pessoal.
          metadata: { code: unidade.code },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'GymUnitCreated',
          aggregateType: 'GymUnit',
          aggregateId: unidade.id,
          payload: { code: unidade.code, timezone: unidade.timezone },
        },
      });

      return unidade;
    });
  }

  /**
   * `updateMany` com `tenantId` no filtro, e nao `update` por id.
   *
   * `update` acharia a unidade de qualquer tenant e so depois falharia --
   * ou pior, alteraria. O `updateMany` filtra e altera no mesmo comando:
   * unidade de outro tenant simplesmente nao entra no conjunto.
   */
  async atualizar(
    contexto: TenantContext,
    id: string,
    // `| undefined` explicito: com `exactOptionalPropertyTypes`, campo
    // opcional nao aceita `undefined` implicitamente, e o Zod devolve
    // exatamente isso para campo ausente num PATCH.
    dados: {
      name?: string | undefined;
      timezone?: string | undefined;
      openingHours?: Prisma.InputJsonValue | undefined;
    },
    correlationId: string,
  ): Promise<GymUnit | null> {
    // Campo ausente no PATCH chega como `undefined`, e o tipo do Prisma nao
    // o aceita sob `exactOptionalPropertyTypes`. Remover a chave e mais
    // correto que passar `undefined`: "nao mexer" e diferente de "gravar
    // vazio".
    const alteracoes = Object.fromEntries(
      Object.entries(dados).filter(([, valor]) => valor !== undefined),
    );

    return this.db.$transaction(async (tx) => {
      const alterados = await tx.gymUnit.updateMany({
        where: { id, tenantId: contexto.tenantId },
        data: alteracoes,
      });

      if (alterados.count === 0) return null;

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: id,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'unit.updated',
          target: 'gym_unit',
          targetId: id,
          correlationId,
          metadata: { campos: Object.keys(dados) },
        },
      });

      return tx.gymUnit.findFirstOrThrow({ where: { id, tenantId: contexto.tenantId } });
    });
  }
}
