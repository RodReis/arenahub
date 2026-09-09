import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

import { PlatformRoute } from '../../common/security/platform-route.decorator.js';
import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * Superficie do dono do SaaS.
 *
 * `@PlatformRoute()` na CLASSE: cada rota nova aqui nasce protegida, sem
 * depender de alguem lembrar de decorar o metodo.
 *
 * Minimo de proposito nesta fatia -- criacao, edicao e elevacao entram nas
 * proximas tasks, neste mesmo arquivo.
 */
@Controller('api/v1/platform')
@PlatformRoute()
export class PlatformController {
  constructor(private readonly db: PrismaService) {}

  @Get('tenants')
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'slug', 'displayName', 'status'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          slug: { type: 'string' },
          displayName: { type: 'string' },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
        },
      },
    },
  })
  async listar(): Promise<Array<{ id: string; slug: string; displayName: string; status: string }>> {
    return this.db.tenant.findMany({
      orderBy: { displayName: 'asc' },
      select: { id: true, slug: true, displayName: true, status: true },
    });
  }
}
