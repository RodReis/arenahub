import { Controller, Get, HttpStatus, HttpException } from '@nestjs/common';

import { Public } from '../common/security/public.decorator.js';

import { lerVersaoDaApi } from '../version.js';
import { VerificadorDeBanco } from './verificador-de-banco.js';

/**
 * `live` e `ready` respondem perguntas diferentes, e confundi-las causa dano
 * oposto ao pretendido:
 *
 * - `live` -- o processo respira? Nao toca no banco. Se dependesse dele, uma
 *   queda do Postgres faria o orquestrador reiniciar a API, que reiniciar nao
 *   conserta;
 * - `ready` -- da para mandar trafego? Ai sim consulta a dependencia.
 */
// Sonda de orquestrador nao tem credencial -- e nao deve precisar de uma.
@Public()
@Controller()
export class HealthController {
  constructor(private readonly banco: VerificadorDeBanco) {}

  @Get('health/live')
  live(): { status: 'live' } {
    return { status: 'live' };
  }

  @Get('health/ready')
  async ready(): Promise<{ status: 'ready' }> {
    const bancoDisponivel = await this.banco.verificar();

    if (!bancoDisponivel) {
      // Codigo estavel e sem detalhe: quem opera precisa saber o que caiu,
      // quem sonda a porta nao precisa saber onde o banco mora.
      throw new HttpException(
        { status: 'unavailable', code: 'HEALTH_DATABASE_UNAVAILABLE' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { status: 'ready' };
  }

  @Get('version')
  version(): { version: string } {
    return { version: lerVersaoDaApi() };
  }
}
