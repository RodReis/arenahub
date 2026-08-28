import { BadRequestException, Body, Controller, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { EngagementRankingService } from './engagement-ranking.service.js';
import { EngagementXpService } from './engagement-xp.service.js';
import type { SnapshotDeRanking } from './engagement-ranking.repository.js';

/** `AAAA-MM` -- mesmo formato de `localMonth` em todo o ledger/placar. */
const REGEX_DO_MES = /^\d{4}-(0[1-9]|1[0-2])$/u;

const esquemaDoMes = z.object({
  gymUnitId: z.string().uuid(),
  mes: z.string().regex(REGEX_DO_MES),
});

/** As tres categorias de placar (F35, ADR-049 Decisao 4). */
const CATEGORIAS = ['XP_DO_MES', 'FREQUENCIA', 'CONSISTENCIA'] as const;

/*
 * Categoria e OPCIONAL com default `XP_DO_MES`: a tela antiga do painel nao
 * a envia, e sem o default toda geracao existente viraria 400 -- quebrar a
 * F31 para acrescentar a F35 nao e acrescentar, e substituir.
 */
const esquemaDaCategoria = z
  .object({ category: z.enum(CATEGORIAS).optional() })
  .strict();

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
  category: string;
  status: string;
  publishedAt: string | null;
  entries: { studentId: string; position: number; points: number }[];
}

const ESQUEMA_DE_RESPOSTA_DO_SNAPSHOT = {
  type: 'object',
  required: ['id', 'category', 'status', 'publishedAt', 'entries'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    category: { type: 'string', enum: ['XP_DO_MES', 'FREQUENCIA', 'CONSISTENCIA'] },
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
  async gerar(@Param() parametros: unknown, @Body() corpo: unknown): Promise<SnapshotDto> {
    const { gymUnitId, mes } = esquemaDoMes.parse(parametros);
    const { category } = esquemaDaCategoria.parse(corpo ?? {});
    const contexto = this.contexto.require();

    // Escopo de unidade (mesmo padrao de `ManualOverrideUseCase`): um
    // gerente restrito a unidade A nao gera placar da unidade B so por
    // saber o UUID dela na URL.
    this.exigirEscopoDaUnidade(contexto, gymUnitId);

    const snapshot = await this.ranking.gerarSnapshot(
      contexto,
      gymUnitId,
      mes,
      new Date(),
      category ?? 'XP_DO_MES',
    );

    return this.paraDto(snapshot);
  }

  @Post('rankings/:snapshotId/publicar')
  @RequirePermissions('engagement.moderate')
  @ApiOkResponse({ schema: ESQUEMA_DE_RESPOSTA_DO_SNAPSHOT })
  async publicar(@Param() parametros: unknown): Promise<SnapshotDto> {
    const { snapshotId } = esquemaDoSnapshot.parse(parametros);
    const contexto = this.contexto.require();

    /*
     * `publicar` nao recebe `gymUnitId` na requisicao -- so no proprio
     * snapshot -- entao o escopo so pode ser checado DEPOIS de carrega-lo.
     * Carregar primeiro e ja tenant-escopado (`snapshotPorId`); se nao
     * existir OU for de outra unidade, o erro tem de ser IDENTICO
     * (`RANKING_SNAPSHOT_NAO_ENCONTRADO`) -- senao a diferenca entre as
     * duas respostas denunciaria a existencia do snapshot alheio.
     */
    const snapshot = await this.ranking.snapshotPorId(contexto, snapshotId);

    if (!snapshot || !this.dentroDoEscopo(contexto, snapshot.gymUnitId)) {
      throw new NotFoundException({
        code: 'RANKING_SNAPSHOT_NAO_ENCONTRADO',
        message: 'RANKING_SNAPSHOT_NAO_ENCONTRADO',
      });
    }

    const publicado = await this.ranking.publicar(contexto, snapshotId, new Date());

    return this.paraDto(publicado);
  }

  /*
   * `engagement.correct`, NAO `engagement.moderate` (F35, ADR-049 Decisao 2).
   * Quem julga apelido nao e necessariamente quem mexe no saldo de XP de um
   * aluno -- mesma separacao de `reconciliation.resolve` e
   * `reconciliation.read`. Nao ha segundo ator: o controle e permissao
   * propria + teto por operacao, que RECUSA acima do limite.
   */
  @Post('xp/:studentId/ajustar')
  @RequirePermissions('engagement.correct')
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
      category: snapshot.category,
      status: snapshot.status,
      publishedAt: snapshot.publishedAt ? snapshot.publishedAt.toISOString() : null,
      entries: snapshot.entries.map((entrada) => ({
        studentId: entrada.studentId,
        position: entrada.position,
        points: entrada.points,
      })),
    };
  }

  /** `true` se o ator pode agir sobre `gymUnitId` -- `allowedUnitIds` e
   * `'ALL'` (papel de tenant inteiro) ou contem a unidade. */
  private dentroDoEscopo(contexto: TenantContext, gymUnitId: string): boolean {
    return contexto.allowedUnitIds === 'ALL' || contexto.allowedUnitIds.has(gymUnitId);
  }

  /** Recusa com `NotFoundException` (nao `Forbidden`) quando a unidade esta
   * fora do escopo do ator -- mesmo padrao de `ManualOverrideUseCase`:
   * nao revelar que a unidade existe e deliberado. */
  private exigirEscopoDaUnidade(contexto: TenantContext, gymUnitId: string): void {
    if (!this.dentroDoEscopo(contexto, gymUnitId)) {
      throw new NotFoundException({ code: 'GYM_UNIT_NOT_FOUND' });
    }
  }
}
