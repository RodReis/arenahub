import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import type { EdgeNode } from '@arenahub/database';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
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
  status: string;
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
    private readonly contexto: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('device.read')
  @ApiOkResponse({ schema: { type: 'array', items: SCHEMA_DO_EDGE_NODE } })
  async listar(): Promise<EdgeNodeDto[]> {
    const encontrados = await this.edgeNodes.listar(this.contexto.require());

    return encontrados.map((n) => this.paraDto(n));
  }

  @Post()
  @RequirePermissions('device.manage')
  @ApiCreatedResponse({ schema: SCHEMA_DO_EDGE_NODE })
  async criar(@Body() corpo: unknown): Promise<EdgeNodeDto> {
    const dados = esquemaDeCriacao.parse(corpo);

    const edgeNode = await this.edgeNodes.criar(this.contexto.require(), dados);

    return this.paraDto(edgeNode);
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
