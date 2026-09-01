import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Req } from '@nestjs/common';
import type { GymUnit } from '@arenahub/database';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { GymUnitRepository } from './gym-unit.repository.js';

/**
 * Horario de funcionamento por dia da semana. JSON porque a forma ainda
 * varia por academia; vira tabela quando alguem precisar consultar por faixa.
 */
const esquemaDeHorario = z.record(
  z.string(),
  z.array(z.object({ abre: z.string(), fecha: z.string() }).strict()),
);

/**
 * `timezone` validado contra a base IANA do proprio runtime, e nao por
 * regex. O ADR-019 faz o bloqueio por inadimplencia depender do fuso da
 * unidade, sem fallback -- fuso invalido gravado hoje vira decisao de acesso
 * errada depois.
 */
const timezoneValido = z.string().refine(
  (valor) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: valor });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'timezone IANA invalido' },
);

// `.strict()`: `tenantId` no corpo e recusado, nao ignorado. O tenant vem da
// identidade autenticada (regra de arquitetura no 2).
const esquemaDeCriacao = z
  .object({
    code: z.string().min(1).max(32),
    name: z.string().min(1).max(120),
    timezone: timezoneValido,
    openingHours: esquemaDeHorario,
  })
  .strict();

const esquemaDeAtualizacao = z
  .object({
    name: z.string().min(1).max(120).optional(),
    timezone: timezoneValido.optional(),
    openingHours: esquemaDeHorario.optional(),
    /*
     * INATIVAR, NUNCA APAGAR -- e por isso nao existe `DELETE /units/:id`.
     *
     * Dez tabelas referenciam `GymUnit` com `onDelete: Cascade`: apagar uma
     * unidade levaria junto dispositivo, evento de acesso e avaliacao fisica
     * -- o historico de quem passou na catraca. `Student.gymUnit` e
     * `Restrict` e ja registrava a intencao do desenho.
     *
     * A coluna e o enum existiam desde o inicio e o DTO de saida sempre
     * devolveu `status`; o que faltava era o caminho de ESCRITA. Ate aqui
     * nenhuma unidade podia ser inativada senao por UPDATE direto no banco
     * (issue #241).
     */
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    /*
     * Motivo do ATO, nao da unidade: vai para o `metadata` do `AuditLog` e
     * nao vira coluna. Minimo de 10 caracteres pelo mesmo motivo que
     * `ManualAccessOverride.reason` -- "ok" nao e motivo.
     */
    reason: z.string().trim().min(10).max(500).optional(),
  })
  .strict()
  /*
   * INATIVAR EXIGE MOTIVO (DS-PAINEL.md §5.1). Reativar e renomear nao: a
   * exigencia existe para a acao que tira a unidade de operacao, e pedir
   * justificativa para trocar um nome so ensinaria a digitar "." no campo.
   */
  .refine((dados) => dados.status !== 'INACTIVE' || dados.reason !== undefined, {
    message: 'Inativar uma unidade exige motivo',
    path: ['reason'],
  });

/** DTO de saida. Nao e a entidade -- `CLAUDE.md`, Convencoes de codigo. */
interface UnidadeDto {
  id: string;
  code: string;
  name: string;
  timezone: string;
  openingHours: unknown;
  status: string;
}

@Controller('api/v1/units')
export class GymUnitController {
  constructor(
    private readonly unidades: GymUnitRepository,
    private readonly contexto: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('unit.read')
  async listar(): Promise<UnidadeDto[]> {
    const encontradas = await this.unidades.listar(this.contexto.require());

    return encontradas.map((u) => this.paraDto(u));
  }

  @Get(':id')
  @RequirePermissions('unit.read')
  async detalhar(@Param('id') id: string): Promise<UnidadeDto> {
    const unidade = await this.unidades.encontrar(this.contexto.require(), id);

    // 404, nunca 403: 403 confirmaria que o recurso existe.
    if (!unidade) throw new NotFoundException({ code: 'UNIT_NOT_FOUND' });

    return this.paraDto(unidade);
  }

  @Post()
  @RequirePermissions('unit.create')
  async criar(@Body() corpo: unknown, @Req() requisicao: Request): Promise<UnidadeDto> {
    const dados = esquemaDeCriacao.parse(corpo);

    const unidade = await this.unidades.criar(
      this.contexto.require(),
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return this.paraDto(unidade);
  }

  @Patch(':id')
  @RequirePermissions('unit.update')
  async atualizar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<UnidadeDto> {
    const { reason, ...dados } = esquemaDeAtualizacao.parse(corpo);

    const unidade = await this.unidades.atualizar(
      this.contexto.require(),
      id,
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
      reason,
    );

    if (!unidade) throw new NotFoundException({ code: 'UNIT_NOT_FOUND' });

    return this.paraDto(unidade);
  }

  private paraDto(unidade: GymUnit): UnidadeDto {
    return {
      id: unidade.id,
      code: unidade.code,
      name: unidade.name,
      timezone: unidade.timezone,
      openingHours: unidade.openingHours,
      status: unidade.status,
    };
  }
}
