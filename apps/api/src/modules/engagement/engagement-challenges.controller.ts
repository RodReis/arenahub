import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { EngagementChallengesService } from './engagement-challenges.service.js';
import {
  PORTA_DE_DESAFIOS,
  type DesafioDaListagem,
  type PortaDeDesafios,
} from './engagement-challenges.repository.js';

/** `AAAA-MM-DD` -- dia local da unidade, o mesmo formato do dominio. */
const REGEX_DO_DIA = /^\d{4}-\d{2}-\d{2}$/u;

const esquemaDeCriacao = z
  .object({
    templateVersionId: z.string().trim().min(1),
    /** `null` = vale para o tenant inteiro. */
    gymUnitId: z.string().uuid().nullable().default(null),
    title: z.string().trim().min(1).max(120),
    targetValue: z.number().int().positive(),
    startsOn: z.string().regex(REGEX_DO_DIA),
    endsOn: z.string().regex(REGEX_DO_DIA),
  })
  .strict();

/**
 * Desafios -- lado da SECRETARIA (F34, Slice 5.5, ADR-048).
 *
 * `engagement.moderate` e nao permissao nova: o seed ja a descreve como
 * *"trabalho de recepcao/operacao"*, que e exatamente quem cria desafio.
 * Permissao nova exigiria migration de papel para separar duas operacoes que
 * a mesma pessoa faz.
 *
 * A rota do ALUNO nao mora aqui -- ela vive em `kiosk.controller.ts`, atras da
 * sessao efemera do totem, porque quem chama e o totem e nao um usuario do
 * painel.
 */
@Controller('api/v1/engagement/challenges')
export class EngagementChallengesController {
  constructor(
    private readonly desafios: EngagementChallengesService,
    private readonly contexto: TenantContextService,
    @Inject(PORTA_DE_DESAFIOS) private readonly porta: PortaDeDesafios,
  ) {}

  /** Templates vigentes -- o que a secretaria pode escolher. */
  @Get('templates')
  @RequirePermissions('engagement.read')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['itens'],
      properties: {
        itens: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'code', 'version', 'name', 'maxSessoesPorSemana', 'maxJanelaEmDias'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              code: { type: 'string' },
              version: { type: 'integer' },
              name: { type: 'string' },
              maxSessoesPorSemana: { type: 'integer' },
              maxJanelaEmDias: { type: 'integer' },
            },
          },
        },
      },
    },
  })
  async templates(): Promise<{
    itens: {
      id: string;
      code: string;
      version: number;
      name: string;
      maxSessoesPorSemana: number;
      maxJanelaEmDias: number;
    }[];
  }> {
    const vigentes = await this.porta.templatesVigentes(this.contexto.require(), new Date());

    return {
      itens: vigentes.map((t) => ({
        id: t.id,
        code: t.code,
        version: t.version,
        name: t.name,
        maxSessoesPorSemana: t.limite.maxSessoesPorSemana,
        maxJanelaEmDias: t.limite.maxJanelaEmDias,
      })),
    };
  }

  /** Os desafios do tenant -- inclusive RASCUNHO, que e o que se abre. */
  @Get()
  @RequirePermissions('engagement.read')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['itens'],
      properties: {
        itens: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'id',
              'title',
              'status',
              'targetValue',
              'startsOn',
              'endsOn',
              'templateName',
              'participantes',
            ],
            properties: {
              id: { type: 'string', format: 'uuid' },
              title: { type: 'string' },
              status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED'] },
              targetValue: { type: 'integer' },
              startsOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              endsOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              templateName: { type: 'string' },
              participantes: { type: 'integer' },
              gymUnitId: { type: 'string', format: 'uuid', nullable: true },
            },
          },
        },
      },
    },
  })
  async listar(): Promise<{ itens: DesafioDaListagem[] }> {
    return { itens: await this.desafios.listar(this.contexto.require()) };
  }

  /**
   * Cria o desafio em RASCUNHO.
   *
   * Nascer `ACTIVE` significaria que um erro de digitacao na meta ja esta
   * recebendo inscricao antes de alguem reler.
   */
  @Post()
  @RequirePermissions('engagement.moderate')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' } },
    },
  })
  async criar(@Body() corpo: unknown): Promise<{ id: string }> {
    const entrada = esquemaDeCriacao.parse(corpo);

    return this.desafios.criar(this.contexto.require(), entrada);
  }

  @Post(':id/activate')
  @RequirePermissions('engagement.moderate')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['ok'],
      properties: { ok: { type: 'boolean' } },
    },
  })
  async ativar(@Param('id') id: string): Promise<{ ok: true }> {
    await this.desafios.ativar(this.contexto.require(), id);

    return { ok: true };
  }
}
