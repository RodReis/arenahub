import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { EngagementService } from './engagement.service.js';
import type { ContestacaoGravada, ContestacaoParaFila } from './engagement.repository.js';

/** Espelham `EngagementDisputeSubject` e `EngagementDisputeStatus`. */
const ASSUNTOS = ['XP', 'CONQUISTA', 'CONSISTENCIA', 'RANKING', 'DESAFIO'] as const;
const ESTADOS = ['ABERTA', 'CORRIGIDA', 'IMPROCEDENTE'] as const;

const esquemaDeListagem = z.object({ status: z.enum(ESTADOS) }).strict();

const esquemaDeResolucao = z
  .object({
    desfecho: z.enum(['CORRIGIDA', 'IMPROCEDENTE']),
    resolucao: z.string().trim().min(1),
  })
  .strict();

interface ContestacaoDto {
  id: string;
  studentId: string;
  subject: string;
  descricao: string;
  status: string;
  resolucao: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface ItemDaFilaDto extends ContestacaoDto {
  alunoNome: string;
}

const ESQUEMA_DA_CONTESTACAO = {
  type: 'object',
  required: ['id', 'studentId', 'subject', 'descricao', 'status', 'resolucao', 'resolvedAt', 'createdAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    studentId: { type: 'string', format: 'uuid' },
    subject: { type: 'string', enum: [...ASSUNTOS] },
    descricao: { type: 'string' },
    status: { type: 'string', enum: [...ESTADOS] },
    resolucao: { type: 'string', nullable: true },
    resolvedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

/**
 * Painel -- fila de contestacoes de engajamento (`M5-FR-016`, F35).
 *
 * O aluno ABRE pelo totem (`KioskController`); aqui a secretaria le e resolve.
 * Nao ha rota de edicao nem de exclusao: resolver GRAVA desfecho, ator e
 * instante, e a contestacao vira historico. Reabrir apagaria quem decidiu.
 */
@Controller('api/v1/engagement/contestacoes')
export class EngagementContestacoesController {
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
            ...ESQUEMA_DA_CONTESTACAO,
            required: [...ESQUEMA_DA_CONTESTACAO.required, 'alunoNome'],
            properties: { ...ESQUEMA_DA_CONTESTACAO.properties, alunoNome: { type: 'string' } },
          },
        },
      },
    },
  })
  async listar(@Query() consulta: unknown): Promise<{ itens: ItemDaFilaDto[] }> {
    const { status } = esquemaDeListagem.parse(consulta);
    const contexto = this.contexto.require();

    /*
     * ESCOPO DE UNIDADE: um gerente restrito a unidade A nao ve contestacao de
     * aluno da unidade B. Mesmo padrao de `ajustarXp` (F31) -- resolver com
     * desfecho CORRIGIDA admite que houve correcao de saldo, e e o mesmo ato
     * visto do outro lado.
     */
    const itens = await this.engajamento.listarContestacoes(
      contexto.tenantId,
      status,
      contexto.allowedUnitIds,
    );

    return { itens: itens.map((item) => this.paraItemDaFila(item)) };
  }

  /*
   * `engagement.correct`, nao `engagement.read`: resolver muda o estado de uma
   * contestacao e, no desfecho CORRIGIDA, admite que houve correcao de saldo.
   * E o mesmo ato de `ajustar` visto do outro lado (ADR-049, Decisao 2).
   */
  @Post(':id/resolver')
  @RequirePermissions('engagement.correct')
  @ApiOkResponse({ schema: ESQUEMA_DA_CONTESTACAO })
  async resolver(@Param('id') id: string, @Body() corpo: unknown): Promise<ContestacaoDto> {
    const entrada = esquemaDeResolucao.parse(corpo);
    const contexto = this.contexto.require();

    const resolvida = await this.engajamento.resolverContestacao(
      contexto.tenantId,
      id,
      entrada,
      contexto.actorId,
      new Date(),
      null,
      contexto.allowedUnitIds,
    );

    return this.paraDto(resolvida);
  }

  private paraDto(contestacao: ContestacaoGravada): ContestacaoDto {
    return {
      id: contestacao.id,
      studentId: contestacao.studentId,
      subject: contestacao.subject,
      descricao: contestacao.descricao,
      status: contestacao.status,
      resolucao: contestacao.resolucao,
      resolvedAt: contestacao.resolvedAt ? contestacao.resolvedAt.toISOString() : null,
      createdAt: contestacao.createdAt.toISOString(),
    };
  }

  private paraItemDaFila(item: ContestacaoParaFila): ItemDaFilaDto {
    return { ...this.paraDto(item), alunoNome: item.alunoNome };
  }
}
