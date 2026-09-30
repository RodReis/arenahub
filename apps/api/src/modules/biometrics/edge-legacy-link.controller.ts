import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { EdgeRoute } from '../edge-auth/edge-route.decorator.js';
import {
  VincularCadastroLegadoUseCase,
  type ResultadoDoVinculoLegado,
} from './vincular-cadastro-legado.use-case.js';

/**
 * O Edge informa os numeros que o leitor tem -- #468.
 *
 * `.strict()` pelo mesmo motivo das outras rotas do Edge: `tenantId` ou
 * `gymUnitId` no corpo sao RECUSADOS, a identidade vem da assinatura HMAC
 * (regra de arquitetura no 2).
 *
 * Teto de 1.000 numeros por chamada: o leitor comporta 5.000 usuarios e o
 * Edge fatia. Um corpo sem teto seria um jeito de prender a API.
 */
const esquemaDoVinculo = z
  .object({
    deviceSerial: z.string().min(1).max(64),
    externalUserIds: z.array(z.string().min(1).max(64)).min(1).max(1000),
  })
  .strict();

const listaDeNumeros = { type: 'array', items: { type: 'string' } };

const ESQUEMA_DO_RESULTADO = {
  type: 'object',
  properties: {
    linked: { type: 'integer' },
    alreadyLinked: { type: 'integer' },
    withoutStudent: listaDeNumeros,
    ambiguous: listaDeNumeros,
    studentAlreadyLinked: listaDeNumeros,
    withoutConsentDocument: listaDeNumeros,
    refusedOrRevoked: listaDeNumeros,
  },
  required: [
    'linked',
    'alreadyLinked',
    'withoutStudent',
    'ambiguous',
    'studentAlreadyLinked',
    'withoutConsentDocument',
    'refusedOrRevoked',
  ],
};

@Controller('api/v1/edge/device-users')
export class EdgeLegacyLinkController {
  constructor(private readonly vincular: VincularCadastroLegadoUseCase) {}

  @Post('legacy-links')
  @EdgeRoute()
  @ApiCreatedResponse({ schema: ESQUEMA_DO_RESULTADO })
  async vincularLegado(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<ResultadoDoVinculoLegado> {
    const dados = esquemaDoVinculo.parse(corpo);

    // Garantido pelo guard: rota marcada sem contexto nao chega aqui.
    const edge = requisicao.edgeContext!;

    return this.vincular.executar(
      edge,
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
      new Date(),
    );
  }
}
