import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { RESULTADOS_DE_TAREFA } from './domain/tarefa-de-retencao.js';
import {
  RetentionTasksQueryService,
  type TarefaParaLeitura,
} from './retention-tasks-query.service.js';
import { RetentionTasksService } from './retention-tasks.service.js';

const CANAIS = ['WHATSAPP'] as const;

const esquemaDaConsulta = z
  .object({ limite: z.coerce.number().int().min(1).max(200).default(50) })
  .strict();

const esquemaDaAtribuicao = z.object({ responsavelId: z.string().uuid() }).strict();

const esquemaDaConclusao = z.object({ resultado: z.enum(RESULTADOS_DE_TAREFA) }).strict();

const esquemaDaDispensa = z
  .object({ motivo: z.string().trim().min(1, 'motivo é obrigatório') })
  .strict();

const esquemaDaInteracao = z
  .object({
    canal: z.enum(CANAIS),
    resultado: z.enum(RESULTADOS_DE_TAREFA),
    observacoes: z.string().trim().min(1).optional(),
    proximoPasso: z.string().trim().min(1).optional(),
  })
  .strict();

interface TarefaDto {
  taskId: string;
  studentId: string;
  gymUnitId: string;
  strategy: string;
  status: string;
  assigneeId: string | null;
  result: string | null;
  dismissReason: string | null;
  dueAt: string;
  createdAt: string;
  overdue: boolean;
  score: { scoreId: string; value: number; band: string };
  factors: { position: number; feature: string; observedValue: number; label: string }[];
  interactions: {
    channel: string;
    result: string;
    actorId: string;
    occurredAt: string;
    notes: string | null;
    nextStep: string | null;
  }[];
}

const ESQUEMA_DE_RESPOSTA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          studentId: { type: 'string' },
          gymUnitId: { type: 'string' },
          strategy: { type: 'string' },
          status: {
            type: 'string',
            enum: ['ABERTA', 'ATRIBUIDA', 'EM_ATENDIMENTO', 'CONCLUIDA', 'DISPENSADA', 'EXPIRADA'],
          },
          assigneeId: { type: 'string', nullable: true },
          result: { type: 'string', nullable: true },
          dismissReason: { type: 'string', nullable: true },
          dueAt: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          overdue: { type: 'boolean' },
          score: {
            type: 'object',
            properties: {
              scoreId: { type: 'string' },
              value: { type: 'integer' },
              band: { type: 'string' },
            },
          },
          factors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                position: { type: 'integer' },
                feature: { type: 'string' },
                observedValue: { type: 'number' },
                label: { type: 'string' },
              },
            },
          },
          interactions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                channel: { type: 'string' },
                result: { type: 'string' },
                actorId: { type: 'string' },
                occurredAt: { type: 'string', format: 'date-time' },
                notes: { type: 'string', nullable: true },
                nextStep: { type: 'string', nullable: true },
              },
            },
          },
        },
      },
    },
  },
};

const VAZIO = { type: 'object', properties: {} };

/**
 * A fila de tarefas de retenção e o registro de contato (F38, Slice 6.3).
 *
 * ---------------------------------------------------------------------------
 * NENHUMA ROTA AQUI ENVIA NADA
 * ---------------------------------------------------------------------------
 *
 * `M6-BR-007` e `M6-AC-010` são explícitos: desconto, mensagem e canal exigem
 * decisão humana, e o score nunca altera acesso ou cobrança automaticamente. O
 * `POST .../interactions` REGISTRA o que a pessoa já fez pelo WhatsApp dela --
 * não dispara mensagem. A diferença é o que separa CRM de retenção de
 * plataforma de marketing, e o `docs/prd/README.md` §3 diz que o ArenaHub não é
 * a segunda.
 *
 * A separação de permissão segue o precedente dos atos excepcionais
 * (`access.override`, `billing.refund`): ler a fila é trabalho diário
 * (`retention.read`); dispensar uma tarefa é decisão com motivo gravado
 * (`retention.task.manage`).
 */
@Controller('api/v1/retention')
export class RetentionTasksController {
  constructor(
    private readonly contexto: TenantContextService,
    private readonly query: RetentionTasksQueryService,
    private readonly tarefas: RetentionTasksService,
  ) {}

  @Get('tasks')
  @RequirePermissions('retention.read')
  @ApiOkResponse({ schema: ESQUEMA_DE_RESPOSTA })
  async listar(@Query() consulta: unknown): Promise<{ items: TarefaDto[] }> {
    const parsed = esquemaDaConsulta.safeParse(consulta);
    if (!parsed.success) {
      throw new BadRequestException('CONSULTA_INVALIDA');
    }

    const fila = await this.query.fila(this.contexto.require(), {
      agora: new Date(),
      limite: parsed.data.limite,
    });

    return { items: fila.map(paraDto) };
  }

  @Post('tasks/:id/assign')
  @RequirePermissions('retention.task.manage')
  @ApiOkResponse({ schema: VAZIO })
  async atribuir(@Param('id') id: string, @Body() corpo: unknown): Promise<Record<string, never>> {
    const parsed = esquemaDaAtribuicao.safeParse(corpo);
    if (!parsed.success) {
      throw new BadRequestException('ATRIBUICAO_INVALIDA');
    }

    await this.tarefas.aplicar(this.contexto.require(), id, {
      tipo: 'ATRIBUIR',
      responsavelId: parsed.data.responsavelId,
    });
    return {};
  }

  @Post('tasks/:id/start')
  @RequirePermissions('retention.task.manage')
  @ApiOkResponse({ schema: VAZIO })
  async iniciar(@Param('id') id: string): Promise<Record<string, never>> {
    await this.tarefas.aplicar(this.contexto.require(), id, { tipo: 'INICIAR' });
    return {};
  }

  @Post('tasks/:id/interactions')
  @RequirePermissions('retention.task.manage')
  @ApiOkResponse({ schema: VAZIO })
  async registrar(
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<Record<string, never>> {
    const parsed = esquemaDaInteracao.safeParse(corpo);
    if (!parsed.success) {
      throw new BadRequestException('INTERACAO_INVALIDA');
    }

    // O responsável sai do contexto autenticado, nunca do corpo: aceitar o id
    // pelo body permitiria atribuir a ligação a outra pessoa.
    await this.tarefas.registrarContato(this.contexto.require(), id, parsed.data);
    return {};
  }

  @Post('tasks/:id/complete')
  @RequirePermissions('retention.task.manage')
  @ApiOkResponse({ schema: VAZIO })
  async concluir(@Param('id') id: string, @Body() corpo: unknown): Promise<Record<string, never>> {
    const parsed = esquemaDaConclusao.safeParse(corpo);
    if (!parsed.success) {
      throw new BadRequestException('RESULTADO_OBRIGATORIO');
    }

    await this.tarefas.aplicar(this.contexto.require(), id, {
      tipo: 'CONCLUIR',
      resultado: parsed.data.resultado,
    });
    return {};
  }

  @Post('tasks/:id/dismiss')
  @RequirePermissions('retention.task.manage')
  @ApiOkResponse({ schema: VAZIO })
  async dispensar(@Param('id') id: string, @Body() corpo: unknown): Promise<Record<string, never>> {
    const parsed = esquemaDaDispensa.safeParse(corpo);
    if (!parsed.success) {
      throw new BadRequestException('MOTIVO_OBRIGATORIO');
    }

    await this.tarefas.aplicar(this.contexto.require(), id, {
      tipo: 'DISPENSAR',
      motivo: parsed.data.motivo,
    });
    return {};
  }
}

function paraDto(tarefa: TarefaParaLeitura): TarefaDto {
  return {
    taskId: tarefa.taskId,
    studentId: tarefa.studentId,
    gymUnitId: tarefa.gymUnitId,
    strategy: tarefa.estrategia,
    status: tarefa.estado,
    assigneeId: tarefa.responsavelId,
    result: tarefa.resultado,
    dismissReason: tarefa.motivo,
    dueAt: tarefa.venceEm.toISOString(),
    createdAt: tarefa.criadaEm.toISOString(),
    overdue: tarefa.vencida,
    score: {
      scoreId: tarefa.score.scoreId,
      value: tarefa.score.valor,
      band: tarefa.score.faixa,
    },
    factors: tarefa.fatores.map((fator) => ({
      position: fator.posicao,
      feature: fator.feature,
      observedValue: fator.valorObservado,
      label: fator.rotulo,
    })),
    interactions: tarefa.interacoes.map((interacao) => ({
      channel: interacao.canal,
      result: interacao.resultado,
      actorId: interacao.actorId,
      occurredAt: interacao.ocorreuEm.toISOString(),
      notes: interacao.observacoes,
      nextStep: interacao.proximoPasso,
    })),
  };
}
