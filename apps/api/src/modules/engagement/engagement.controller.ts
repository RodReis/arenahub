import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import type { PerfilPublicoDoAluno } from './engagement.repository.js';
import { EngagementService } from './engagement.service.js';

const RAZOES_DE_REJEICAO = [
  'OFENSIVO',
  'CONTEM_PII',
  'IMPERSONACAO',
  'SPAM_OU_PROPAGANDA',
  'ILEGIVEL',
] as const;

const esquemaDeListagem = z
  .object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN']),
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
  async listar(@Query() consulta: unknown): Promise<{ itens: PerfilDto[] }> {
    const filtro = esquemaDeListagem.parse(consulta);

    const perfis = await this.engajamento.listarParaModeracao(this.contexto.require(), {
      status: filtro.status,
    });

    return { itens: perfis.map((p) => this.paraDto(p)) };
  }

  @Patch(':id')
  @RequirePermissions('engagement.moderate')
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
}
