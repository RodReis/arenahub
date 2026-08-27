import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { EngagementRankingService } from './engagement-ranking.service.js';
import { EngagementXpService } from './engagement-xp.service.js';
import type { SnapshotDeRanking } from './engagement-ranking.repository.js';

/** `AAAA-MM` -- mesmo formato de `localMonth` em todo o ledger/placar. */
const REGEX_DO_MES = /^\d{4}-(0[1-9]|1[0-2])$/u;

const esquemaDoMes = z.object({
  gymUnitId: z.string().uuid(),
  mes: z.string().regex(REGEX_DO_MES),
});

/*
 * SEM `.uuid()`: diferente de `gymUnitId` (entrada do usuario no formulario
 * de geracao), `snapshotId` so circula entre telas do proprio painel --
 * mesmo padrao de `EngagementController.moderar` (`:id` sem formato
 * exigido). Validar formato aqui so rejeitaria cedo o que a consulta ao
 * repositorio (404 `RANKING_SNAPSHOT_NAO_ENCONTRADO`) ja rejeita depois.
 */
const esquemaDoSnapshot = z.object({
  snapshotId: z.string().trim().min(1),
});

const esquemaDoAjuste = z
  .object({
    pontos: z.number().int().refine((valor) => valor !== 0, 'pontos nao pode ser zero'),
    motivo: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1),
  })
  .strict();

interface SnapshotDto {
  id: string;
  status: string;
  publishedAt: string | null;
  entries: { studentId: string; position: number; points: number }[];
}

const ESQUEMA_DE_RESPOSTA_DO_SNAPSHOT = {
  type: 'object',
  required: ['id', 'status', 'publishedAt', 'entries'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'WITHHELD'] },
    publishedAt: { type: 'string', format: 'date-time', nullable: true },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        required: ['studentId', 'position', 'points'],
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          position: { type: 'integer' },
          points: { type: 'integer' },
        },
      },
    },
  },
};

/**
 * Painel -- publicar placar mensal e ajustar XP (F31, Task 11).
 *
 * NAO HA ROTA DE EDICAO aqui, de proposito. O ledger e append-only (trigger
 * no banco, Task 1) e o snapshot publicado e imutavel (`M5-AC-007`):
 * corrigir e sempre GRAVAR algo novo (movimento compensatorio, novo
 * snapshot), nunca reescrever o que ja existe.
 */
@Controller('api/v1/engagement')
export class EngagementXpController {
  constructor(
    private readonly ranking: EngagementRankingService,
    private readonly xp: EngagementXpService,
    private readonly contexto: TenantContextService,
  ) {}

  @Post('rankings/:gymUnitId/:mes/gerar')
  @RequirePermissions('engagement.moderate')
  @ApiOkResponse({ schema: ESQUEMA_DE_RESPOSTA_DO_SNAPSHOT })
  async gerar(@Param() parametros: unknown): Promise<SnapshotDto> {
    const { gymUnitId, mes } = esquemaDoMes.parse(parametros);

    const snapshot = await this.ranking.gerarSnapshot(
      this.contexto.require(),
      gymUnitId,
      mes,
      new Date(),
    );

    return this.paraDto(snapshot);
  }

  @Post('rankings/:snapshotId/publicar')
  @RequirePermissions('engagement.moderate')
  @ApiOkResponse({ schema: ESQUEMA_DE_RESPOSTA_DO_SNAPSHOT })
  async publicar(@Param() parametros: unknown): Promise<SnapshotDto> {
    const { snapshotId } = esquemaDoSnapshot.parse(parametros);

    const snapshot = await this.ranking.publicar(this.contexto.require(), snapshotId, new Date());

    return this.paraDto(snapshot);
  }

  @Post('xp/:studentId/ajustar')
  @RequirePermissions('engagement.moderate')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['ajustado'],
      properties: { ajustado: { type: 'boolean' } },
    },
  })
  async ajustar(
    @Param('studentId') studentId: string,
    @Body() corpo: unknown,
  ): Promise<{ ajustado: boolean }> {
    if (!z.string().uuid().safeParse(studentId).success) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'studentId invalido' });
    }

    const entrada = esquemaDoAjuste.parse(corpo);

    await this.xp.ajustarXp(
      this.contexto.require(),
      studentId,
      entrada,
      new Date(),
    );

    return { ajustado: true };
  }

  private paraDto(snapshot: SnapshotDeRanking): SnapshotDto {
    return {
      id: snapshot.id,
      status: snapshot.status,
      publishedAt: snapshot.publishedAt ? snapshot.publishedAt.toISOString() : null,
      entries: snapshot.entries.map((entrada) => ({
        studentId: entrada.studentId,
        position: entrada.position,
        points: entrada.points,
      })),
    };
  }
}
