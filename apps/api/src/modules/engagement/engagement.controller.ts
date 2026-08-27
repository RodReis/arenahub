import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import type { PerfilParaModeracao, PerfilPublicoDoAluno } from './engagement.repository.js';
import { EngagementService } from './engagement.service.js';

const RAZOES_DE_REJEICAO = [
  'OFENSIVO',
  'CONTEM_PII',
  'IMPERSONACAO',
  'SPAM_OU_PROPAGANDA',
  'ILEGIVEL',
] as const;

/** Espelham `PublicProfileStatus` e `PublicIdentityChoice` do schema. */
const ESTADOS_DO_PERFIL = ['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN'] as const;
const IDENTIDADES = ['PRIMEIRO_NOME', 'APELIDO', 'ANONIMO'] as const;

const esquemaDeListagem = z
  .object({
    status: z.enum(ESTADOS_DO_PERFIL),
  })
  .strict();

const esquemaDeModeracao = z
  .object({
    decisao: z.enum(['APPROVED', 'REJECTED']),
    rejectionReason: z.enum(RAZOES_DE_REJEICAO).nullish(),
  })
  .strict();

interface PerfilDto {
  id: string;
  identityChoice: string;
  alias: string | null;
  status: string;
  screeningSignals: readonly string[];
  rejectionReason: string | null;
  version: number;
}

/**
 * Item da fila de moderacao -- `PerfilDto` mais o nome do aluno.
 *
 * Tipo PROPRIO, nao extensao do `PerfilDto` usado por `moderar`: aquele e a
 * forma que tambem alimenta `obterPreferencias` (consumida pelo totem), e o
 * totem nao deve ganhar um campo que so a tela de moderacao precisa. Nome
 * COMPLETO (nao primeiro nome): o moderador julga o perfil de outra pessoa e
 * precisa distinguir alunos que compartilham o primeiro nome.
 */
interface ItemDaFilaDto extends PerfilDto {
  alunoNome: string;
}

/**
 * Fila de moderacao de apelido no painel -- Task 7 da F30.
 *
 * O moderador so julga o que o aluno escreveu (`APPROVED`/`REJECTED`); nao
 * ha rota de edicao aqui. A validacao de `rejectionReason` obrigatorio ja
 * vive no `EngagementService` (Task 4) -- este controller nao a duplica, so
 * deixa o `BadRequestException` sair como `problem+json`.
 */
@Controller('api/v1/engagement/aliases')
export class EngagementController {
  constructor(
    private readonly engajamento: EngagementService,
    private readonly contexto: TenantContextService,
  ) {}

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
            required: ['id', 'identityChoice', 'alias', 'status', 'version', 'alunoNome'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              identityChoice: { type: 'string', enum: [...IDENTIDADES] },
              alias: { type: 'string', nullable: true },
              aliasNormalized: { type: 'string', nullable: true },
              status: { type: 'string', enum: [...ESTADOS_DO_PERFIL] },
              screeningSignals: { type: 'array', items: { type: 'string' } },
              rejectionReason: { type: 'string', enum: [...RAZOES_DE_REJEICAO], nullable: true },
              version: { type: 'integer' },
              /** Nome COMPLETO: quem modera precisa distinguir homonimos. */
              alunoNome: { type: 'string' },
            },
          },
        },
      },
    },
  })
  async listar(@Query() consulta: unknown): Promise<{ itens: ItemDaFilaDto[] }> {
    const filtro = esquemaDeListagem.parse(consulta);

    const perfis = await this.engajamento.listarParaModeracao(this.contexto.require(), {
      status: filtro.status,
    });

    return { itens: perfis.map((p) => this.paraItemDaFila(p)) };
  }

  @Patch(':id')
  @RequirePermissions('engagement.moderate')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['id', 'identityChoice', 'alias', 'status', 'version'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        identityChoice: { type: 'string', enum: [...IDENTIDADES] },
        alias: { type: 'string', nullable: true },
        aliasNormalized: { type: 'string', nullable: true },
        status: { type: 'string', enum: [...ESTADOS_DO_PERFIL] },
        screeningSignals: { type: 'array', items: { type: 'string' } },
        rejectionReason: { type: 'string', enum: [...RAZOES_DE_REJEICAO], nullable: true },
        version: { type: 'integer' },
      },
    },
  })
  async moderar(@Param('id') id: string, @Body() corpo: unknown): Promise<PerfilDto> {
    const entrada = esquemaDeModeracao.parse(corpo);

    const perfil = await this.engajamento.moderarAlias(
      this.contexto.require(),
      {
        perfilId: id,
        decisao: entrada.decisao,
        rejectionReason: entrada.rejectionReason ?? null,
      },
      new Date(),
    );

    return this.paraDto(perfil);
  }

  private paraDto(perfil: PerfilPublicoDoAluno): PerfilDto {
    return {
      id: perfil.id,
      identityChoice: perfil.identityChoice,
      alias: perfil.alias,
      status: perfil.status,
      screeningSignals: perfil.screeningSignals,
      rejectionReason: perfil.rejectionReason,
      version: perfil.version,
    };
  }

  private paraItemDaFila(perfil: PerfilParaModeracao): ItemDaFilaDto {
    return { ...this.paraDto(perfil), alunoNome: perfil.alunoNome };
  }
}
