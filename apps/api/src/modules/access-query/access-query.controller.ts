import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { z } from 'zod';

import { enumOpcionalDeQuery } from '../../common/http/enum-opcional-de-query.js';
import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import {
  AccessQueryRepository,
  PERIODO_PADRAO_HORAS,
  type PaginaDeEventos,
} from './access-query.repository.js';

/**
 * Consulta de eventos -- `M1-FR-024`, `M1-AC-011`.
 *
 * O aceite da Slice 1.6 e "operar um turno sem acesso a banco". Estas rotas
 * sao o que substitui o `psql` na investigacao: quem quer saber por que
 * alguem nao entrou as 7h de ontem pergunta aqui.
 */
const esquemaDeConsulta = z
  .object({
    /** ISO-8601. Ausentes = ultimas 24 h. */
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    gymUnitId: z.string().uuid().optional(),
    studentId: z.string().uuid().optional(),
    /*
     * `enumOpcionalDeQuery` e nao `z.enum(...).optional()` (FIX): o combo
     * "Todos" da tela serializa como `outcome=`, string vazia -- e
     * `.optional()` sozinho so aceita `undefined`, nunca `''`.
     */
    outcome: enumOpcionalDeQuery(['ALLOW', 'DENY']),
    mode: enumOpcionalDeQuery(['ONLINE', 'OFFLINE', 'OVERRIDE']),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

@Controller('api/v1/access-events')
export class AccessQueryController {
  constructor(
    private readonly consulta: AccessQueryRepository,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * Lista eventos com periodo limitado e cursor estavel.
   *
   * O periodo e SEMPRE limitado, mesmo quando o cliente nao manda: sem isso, a
   * primeira consulta sem filtro varreria a tabela inteira e deixaria a API
   * indisponivel para quem esta na catraca.
   */
  @Get()
  @RequirePermissions('access.read')
  async listar(@Query() consulta: unknown): Promise<PaginaDeEventos> {
    const filtro = esquemaDeConsulta.parse(consulta);

    const ate = filtro.to ? new Date(filtro.to) : new Date();
    const de = filtro.from
      ? new Date(filtro.from)
      : new Date(ate.getTime() - PERIODO_PADRAO_HORAS * 3_600_000);

    return this.consulta.listar(this.contexto.require(), {
      de,
      ate,
      gymUnitId: filtro.gymUnitId,
      studentId: filtro.studentId,
      outcome: filtro.outcome,
      mode: filtro.mode,
      cursor: filtro.cursor,
      limite: filtro.limit,
    });
  }

  /**
   * Detalhe de um evento, com as correcoes vinculadas.
   *
   * 404 indistinguivel entre "nao existe" e "e de outro tenant": a diferenca
   * confirmaria a existencia de um id que quem pergunta nao deveria conhecer.
   */
  @Get(':id')
  @RequirePermissions('access.read')
  async detalhar(@Param('id') id: string): Promise<unknown> {
    const detalhe = await this.consulta.detalhar(this.contexto.require(), id);

    if (!detalhe) throw new NotFoundException({ code: 'ACCESS_EVENT_NOT_FOUND' });

    return detalhe;
  }
}
