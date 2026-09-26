import { BadRequestException, Body, Controller, NotFoundException, Post } from '@nestjs/common';
import { ApiCreatedResponse } from '@nestjs/swagger';
import type { EdgeNode, EdgeNodeStatus } from '@arenahub/database';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { GymUnitRepository } from '../tenancy/gym-unit.repository.js';
import { EdgeNodeRepository } from './edge-node.repository.js';

// `.strict()`: `tenantId` no corpo e RECUSADO. O tenant vem da identidade
// autenticada (regra de arquitetura no 2).
const esquemaDeCriacao = z
  .object({
    gymUnitId: z.string().uuid(),
    code: z.string().min(1).max(80),
  })
  .strict();

interface EdgeNodeDto {
  id: string;
  gymUnitId: string;
  code: string;
  /*
   * O tipo do Prisma, nao `string`: o OpenAPI promete `enum` logo abaixo, e
   * `string` deixaria o tipo mentir sobre o contrato (ADR-005 -- vocabulario
   * unico entre schema, tipo e documento).
   */
  status: EdgeNodeStatus;
  agentVersion: string | null;
  lastHeartbeat: string | null;
}

/** Forma da resposta, declarada para a guarda de OpenAPI (fix #163). */
const SCHEMA_DO_EDGE_NODE = {
  type: 'object',
  required: ['id', 'gymUnitId', 'code', 'status'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    gymUnitId: { type: 'string', format: 'uuid' },
    code: { type: 'string' },
    status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] },
    agentVersion: { type: 'string', nullable: true },
    lastHeartbeat: { type: 'string', format: 'date-time', nullable: true },
  },
};

/**
 * Cadastro de `EdgeNode` (issue #404).
 *
 * Ate aqui so existia `POST /api/v1/edge-nodes/:id/pairing-codes`
 * (`pairing-codes.controller.ts`), que exige um `EdgeNode` ja existente --
 * mas nao havia como cria-lo, nem por API nem pelo painel. A instalacao real
 * do edge-agent na Arena Positiva (26/09/2026) travou exatamente aqui.
 */
@Controller('api/v1/edge-nodes')
export class EdgeNodesController {
  constructor(
    private readonly edgeNodes: EdgeNodeRepository,
    private readonly unidades: GymUnitRepository,
    private readonly contexto: TenantContextService,
  ) {}

  @Post()
  @RequirePermissions('device.manage')
  @ApiCreatedResponse({ schema: SCHEMA_DO_EDGE_NODE })
  async criar(@Body() corpo: unknown): Promise<EdgeNodeDto> {
    const dados = esquemaDeCriacao.parse(corpo);

    await this.exigirUnidadeDoTenant(dados.gymUnitId);

    const edgeNode = await this.edgeNodes.criar(this.contexto.require(), dados);

    return this.paraDto(edgeNode);
  }

  /**
   * A unidade tem de ser DESTE tenant -- regra de arquitetura no 2, INV-006.
   *
   * `EdgeNode.gymUnitId` nao tem FK para `GymUnit` no schema, entao o banco
   * nao barra: sem esta checagem, um admin do tenant A criaria um Edge
   * apontando para a unidade FISICA do tenant B, e o pareamento (ADR-011)
   * passaria a vincular um par inconsistente -- num agente que decide catraca.
   *
   * 404 e nao 403 pelo mesmo motivo do resto do sistema: distinguir "nao
   * existe" de "existe mas e de outro tenant" confirmaria ao atacante que ele
   * acertou o UUID.
   */
  private async exigirUnidadeDoTenant(gymUnitId: string): Promise<void> {
    const unidade = await this.unidades.encontrar(this.contexto.require(), gymUnitId);

    if (!unidade) throw new NotFoundException({ code: 'GYM_UNIT_NOT_FOUND' });

    /*
     * Unidade inativa não recebe Edge novo -- a academia fechou aquela porta.
     * A REGRA VIVE AQUI, e não só no filtro da tela: um `POST` direto
     * contornaria a tela, e o Edge é o agente que decide catraca de uma
     * instalação física que já não opera.
     */
    if (unidade.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'GYM_UNIT_NOT_ACTIVE' });
    }
  }

  private paraDto(edgeNode: EdgeNode): EdgeNodeDto {
    return {
      id: edgeNode.id,
      gymUnitId: edgeNode.gymUnitId,
      code: edgeNode.code,
      status: edgeNode.status,
      agentVersion: edgeNode.agentVersion,
      lastHeartbeat: edgeNode.lastHeartbeat?.toISOString() ?? null,
    };
  }
}
