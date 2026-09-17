import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiCreatedResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RecusaDePareamentoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { PairingService } from './pairing.service.js';

/**
 * `.strict()`: o corpo so aceita `code`. Igual ao resto do modulo, campo
 * extra e recusado, nao ignorado.
 */
const esquemaDeTroca = z.object({ code: z.string().min(8).max(200) }).strict();

interface RespostaDeTroca {
  keyId: string;
  secret: string;
}

@Controller('api/v1/edge')
export class PairingController {
  constructor(private readonly pairing: PairingService) {}

  /**
   * Troca codigo de pareamento por credencial -- SEM `@EdgeRoute()`. O
   * agente ainda nao tem `keyId`/`secret` neste ponto; a autenticacao E o
   * proprio codigo de uso unico, nao HMAC (ver nota de arquitetura no PR da
   * F59, Task 8).
   *
   * `@Public()` sozinho, e nao `@EdgeRoute()`: precisa escapar do
   * `AuthGuard` (sessao de painel), mas NAO deve escapar marcado como rota
   * de Edge -- isso faria o `EdgeAuthGuard` exigir HMAC que o agente ainda
   * nao tem como assinar.
   */
  @Post('pair')
  @Public()
  @HttpCode(201)
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['keyId', 'secret'],
      properties: {
        keyId: { type: 'string' },
        secret: { type: 'string' },
      },
    },
  })
  async pair(@Body() corpo: unknown): Promise<RespostaDeTroca> {
    const dados = esquemaDeTroca.parse(corpo);

    const resultado = await this.pairing.trocar(dados.code);

    if (resultado.estado === 'recusado') {
      throw new RecusaDePareamentoError();
    }

    return { keyId: resultado.keyId, secret: resultado.secret };
  }
}
