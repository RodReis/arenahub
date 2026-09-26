import { Injectable } from '@nestjs/common';
import { Prisma, type EdgeNode } from '@arenahub/database';

import { EdgeNodeCodigoDuplicadoError } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

export interface DadosDeEdgeNode {
  gymUnitId: string;
  code: string;
}

/**
 * Cadastro de `EdgeNode` (issue #404).
 *
 * Ate aqui so existia o SUB-recurso de pareamento
 * (`pairing-codes.controller.ts`), que exige um `EdgeNode` ja existente --
 * mas nao havia como cria-lo. Sem este repositorio, a instalacao real do
 * edge-agent nao tem `edgeNodeId` para gerar o codigo de pareamento.
 */
@Injectable()
export class EdgeNodeRepository {
  constructor(private readonly db: PrismaService) {}

  async criar(contexto: TenantContext, dados: DadosDeEdgeNode): Promise<EdgeNode> {
    try {
      return await this.db.edgeNode.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: dados.gymUnitId,
          code: dados.code,
        },
      });
    } catch (erro) {
      if (violacaoDeUnicidade(erro)) {
        throw new EdgeNodeCodigoDuplicadoError();
      }

      throw erro;
    }
  }

}

/**
 * Violacao de unicidade do Prisma (P2002).
 *
 * Aqui significa uma coisa so: `(tenantId, code)` ja usado por outro EdgeNode
 * deste tenant.
 */
function violacaoDeUnicidade(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';
}
