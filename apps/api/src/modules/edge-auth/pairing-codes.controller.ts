import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse } from '@nestjs/swagger';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { PairingService } from './pairing.service.js';

interface RespostaDeGeracao {
  code: string;
  expiresAt: string;
}

/**
 * Rota do painel que gera o codigo de pareamento consumido por
 * `POST /api/v1/edge/pair` (Task 8).
 *
 * Autenticada como usuario do painel (cookie de sessao + `TenantContext`),
 * NAO como Edge -- e o inverso semantico de `PairingController`: aqui quem
 * chama ja tem sessao, e o proposito e produzir o segredo que o agente vai
 * consumir depois.
 */
@Controller('api/v1/edge-nodes')
export class PairingCodesController {
  constructor(
    private readonly pairing: PairingService,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * `code` so aparece NESTA resposta, uma unica vez -- mesmo principio de
   * segredo que `EdgeCredential.encryptedSecret`. Nao fica em log, nao e
   * recuperavel depois.
   */
  @Post(':edgeNodeId/pairing-codes')
  @RequirePermissions('device.manage')
  @HttpCode(201)
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['code', 'expiresAt'],
      properties: {
        code: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async gerar(@Param('edgeNodeId') edgeNodeId: string): Promise<RespostaDeGeracao> {
    const { tenantId } = this.contexto.require();

    const resultado = await this.pairing.gerar(tenantId, edgeNodeId);

    return { code: resultado.code, expiresAt: resultado.expiresAt.toISOString() };
  }
}
