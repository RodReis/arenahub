import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

import { Public } from '../../common/security/public.decorator.js';
import { contarEstatisticasPublicas } from './estatisticas-publicas.js';
import { PrismaService } from '../../persistence/prisma.service.js';

const ESQUEMA = {
  type: 'object',
  required: ['totalAlunosAtivos', 'totalUnidadesAtivas'],
  properties: {
    totalAlunosAtivos: { type: 'number' },
    totalUnidadesAtivas: { type: 'number' },
  },
};

/**
 * Cinco minutos, mesmo prazo do `BrandingPublicoController` -- a contagem nao
 * muda visita a visita, e o login e a tela mais batida do painel.
 */
const CACHE = 'public, max-age=300';

/**
 * Contagem agregada entre tenants, para o rodape da tela de login sem slug --
 * F71.
 *
 * CONTROLLER SEPARADO do `BrandingPublicoController`, mesmo os dois sendo
 * `@Public()`: aquele e sobre a marca de UM tenant (por slug); este atravessa
 * todos. Misturar os dois faria a proxima rota de marca herdar, sem querer, o
 * habito de ler entre tenants.
 */
@Controller('api/v1/plataforma')
@Public()
export class EstatisticasPublicasController {
  constructor(private readonly db: PrismaService) {}

  @Get('estatisticas-publicas')
  @ApiOkResponse({ schema: ESQUEMA })
  @Header('Cache-Control', CACHE)
  async estatisticas(): Promise<{ totalAlunosAtivos: number; totalUnidadesAtivas: number }> {
    return contarEstatisticasPublicas(this.db);
  }
}
