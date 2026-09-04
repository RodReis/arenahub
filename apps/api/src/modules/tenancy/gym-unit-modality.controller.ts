import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { GymUnitModality } from '@arenahub/database';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { GymUnitModalityRepository } from './gym-unit-modality.repository.js';
import { GymUnitRepository } from './gym-unit.repository.js';

// `.strict()`: `tenantId` e `gymUnitId` no corpo sao recusados, nao
// ignorados. O tenant vem da identidade autenticada e a unidade vem da rota
// (regra de arquitetura no 2).
const esquemaDeCriacao = z.object({ name: z.string().trim().min(2).max(80) }).strict();

const esquemaDeAtualizacao = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    /*
     * INATIVAR, NUNCA APAGAR -- e por isso nao existe `DELETE`. Aluno ja
     * vinculado ficaria orfao, e o historico de quem treinou o que sumiria.
     * Mesma escolha que a propria unidade faz em `GymUnitController`.
     */
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((dados) => Object.keys(dados).length > 0, {
    message: 'Informe ao menos um campo',
  });

/**
 * Schema da modalidade no contrato OpenAPI.
 *
 * Declarado, e nao adicionado a `OPERACOES_SEM_SCHEMA_DE_RESPOSTA`: aquela
 * lista e divida herdada e SO PODE ENCOLHER -- rota nova descreve o proprio
 * corpo.
 */
/*
 * SEM `as const`, e sem anotar `SchemaObject`: com `as const` o `required`
 * vira `readonly string[]`, que o tipo do Swagger recusa, e `SchemaObject` so
 * e exportado de um caminho interno do pacote (`dist/interfaces/...`), que o
 * `moduleResolution` do projeto nao resolve. Objeto simples resolve os dois.
 */
const ESQUEMA_DA_MODALIDADE = {
  type: 'object',
  required: ['id', 'gymUnitId', 'name', 'isActive'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    gymUnitId: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    isActive: { type: 'boolean' },
  },
};

const ESQUEMA_DA_LISTA = { type: 'array', items: ESQUEMA_DA_MODALIDADE };

/** DTO de saida. Nao e a entidade -- `CLAUDE.md`, Convencoes de codigo. */
interface ModalidadeDto {
  id: string;
  gymUnitId: string;
  name: string;
  isActive: boolean;
}

/**
 * Modalidades de uma unidade -- F60.
 *
 * ANINHADO EM `/units/:unitId`, e nao em `/modalities` na raiz: modalidade
 * nao existe fora de uma unidade (decisao do PI em 04/09/2026), e a rota
 * plana faria a unidade virar filtro opcional de um recurso que nao e
 * global.
 */
@Controller('api/v1/units')
export class GymUnitModalityController {
  constructor(
    private readonly modalidades: GymUnitModalityRepository,
    private readonly unidades: GymUnitRepository,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * Modalidades ATIVAS de todas as unidades do tenant.
   *
   * Declarada ANTES de `:unitId/modalities`: o Nest casa por ordem, e
   * `modalities` bateria em `:unitId` se viesse depois.
   */
  @Get('modalities')
  @RequirePermissions('unit.read')
  @ApiOkResponse({ schema: ESQUEMA_DA_LISTA })
  async listarDoTenant(): Promise<ModalidadeDto[]> {
    const encontradas = await this.modalidades.listarDoTenant(this.contexto.require());

    return encontradas.map((m) => this.paraDto(m));
  }

  @Get(':unitId/modalities')
  @RequirePermissions('unit.read')
  @ApiOkResponse({ schema: ESQUEMA_DA_LISTA })
  async listar(
    @Param('unitId') unitId: string,
    @Query('onlyActive') onlyActive?: string,
  ): Promise<ModalidadeDto[]> {
    await this.exigirUnidade(unitId);

    const encontradas = await this.modalidades.listar(
      this.contexto.require(),
      unitId,
      onlyActive === 'true',
    );

    return encontradas.map((m) => this.paraDto(m));
  }

  @Post(':unitId/modalities')
  @RequirePermissions('unit.update')
  @ApiCreatedResponse({ schema: ESQUEMA_DA_MODALIDADE })
  async criar(
    @Param('unitId') unitId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<ModalidadeDto> {
    const { name } = esquemaDeCriacao.parse(corpo);

    await this.exigirUnidade(unitId);

    try {
      const modalidade = await this.modalidades.criar(
        this.contexto.require(),
        unitId,
        name,
        requisicao.correlationId ?? 'sem-correlacao',
      );

      return this.paraDto(modalidade);
    } catch (erro) {
      /*
       * A UNICIDADE E DO BANCO, NAO DE UM `SELECT` ANTES.
       *
       * Duas recepcoes cadastrando "Cross Fit" no mesmo instante passariam
       * as duas por uma checagem previa e a segunda estouraria 500. O indice
       * unico `(gym_unit_id, name)` e quem decide; aqui so se traduz.
       */
      if (ehViolacaoDeUnicidade(erro)) {
        throw new ConflictException({ code: 'MODALITY_ALREADY_EXISTS' });
      }

      throw erro;
    }
  }

  @Patch(':unitId/modalities/:modalityId')
  @RequirePermissions('unit.update')
  @ApiOkResponse({ schema: ESQUEMA_DA_MODALIDADE })
  async atualizar(
    @Param('unitId') unitId: string,
    @Param('modalityId') modalityId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<ModalidadeDto> {
    const dados = esquemaDeAtualizacao.parse(corpo);

    await this.exigirUnidade(unitId);

    try {
      const modalidade = await this.modalidades.atualizar(
        this.contexto.require(),
        unitId,
        modalityId,
        dados,
        requisicao.correlationId ?? 'sem-correlacao',
      );

      // 404, nunca 403: 403 confirmaria que o recurso existe.
      if (!modalidade) throw new NotFoundException({ code: 'MODALITY_NOT_FOUND' });

      return this.paraDto(modalidade);
    } catch (erro) {
      if (ehViolacaoDeUnicidade(erro)) {
        throw new ConflictException({ code: 'MODALITY_ALREADY_EXISTS' });
      }

      throw erro;
    }
  }

  private async exigirUnidade(unitId: string): Promise<void> {
    const unidade = await this.unidades.encontrar(this.contexto.require(), unitId);

    if (!unidade) throw new NotFoundException({ code: 'UNIT_NOT_FOUND' });
  }

  private paraDto(modalidade: GymUnitModality): ModalidadeDto {
    return {
      id: modalidade.id,
      gymUnitId: modalidade.gymUnitId,
      name: modalidade.name,
      isActive: modalidade.isActive,
    };
  }
}

/**
 * `P2002` e o codigo de violacao de indice unico do Prisma.
 *
 * Lido do `code`, e NAO do `meta.target`: com o `adapter-pg` do Prisma 7 o
 * nome do constraint so vem em texto livre, e checar por ele falharia calado
 * quando a mensagem mudasse. Aqui existe um unico indice unico na tabela --
 * o codigo sozinho ja identifica qual foi.
 */
function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002';
}
