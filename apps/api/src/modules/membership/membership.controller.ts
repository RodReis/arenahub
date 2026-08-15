import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { MINUTOS_POR_DIA } from './domain/plan.js';
import {
  ConflitoDeVersaoError,
  MembershipRepository,
  type EntitlementComJanelas,
  type PlanoComRegras,
} from './membership.repository.js';

const janela = z
  .object({
    gymUnitId: z.uuid(),
    dayOfWeek: z.number().int().min(1).max(7),
    startMinute: z.number().int().min(0).max(MINUTOS_POR_DIA),
    endMinute: z.number().int().min(0).max(MINUTOS_POR_DIA),
  })
  .strict();

const esquemaDePlano = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    gymUnitIds: z.array(z.uuid()).min(1),
    janelas: z.array(janela).min(1).max(200),
    salesStartAt: z.iso.datetime().optional(),
    salesEndAt: z.iso.datetime().optional(),
  })
  .strict();

const esquemaDeAtivacao = z
  .object({
    studentId: z.uuid(),
    planId: z.uuid(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    // Razao obrigatoria: no MVP 1 toda mudanca de assinatura e manual
    // (INV-061), e trilha sem motivo nao explica nada depois.
    reason: z.string().min(3).max(300),
  })
  .strict();

const esquemaDeAlteracao = z
  .object({
    action: z.enum(['PAUSE', 'RESUME', 'CANCEL']),
    version: z.number().int().min(0),
    reason: z.string().min(3).max(300),
  })
  .strict();

const esquemaDeCortesia = z
  .object({
    studentId: z.uuid(),
    gymUnitIds: z.array(z.uuid()).min(1),
    janelas: z.array(janela).min(1).max(200),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    // INV-063: razao e responsavel obrigatorios. O responsavel vem do
    // `TenantContext`, nao do corpo.
    reason: z.string().min(3).max(300),
  })
  .strict();

interface PlanoDto {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  gymUnitIds: string[];
  janelas: { gymUnitId: string; dayOfWeek: number; startMinute: number; endMinute: number }[];
}

interface EntitlementDto {
  id: string;
  source: string;
  status: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  subscriptionId: string | null;
  janelas: { gymUnitId: string; dayOfWeek: number; startMinute: number; endMinute: number }[];
}

@Controller('api/v1')
export class MembershipController {
  constructor(
    private readonly membership: MembershipRepository,
    private readonly contexto: TenantContextService,
  ) {}

  @Post('plans')
  @RequirePermissions('plan.manage')
  async criarPlano(@Body() corpo: unknown, @Req() requisicao: Request): Promise<PlanoDto> {
    const dados = esquemaDePlano.parse(corpo);

    const plano = await this.membership.criarPlano(
      this.contexto.require(),
      {
        name: dados.name,
        description: dados.description,
        gymUnitIds: dados.gymUnitIds,
        janelas: dados.janelas,
        salesStartAt: dados.salesStartAt ? new Date(dados.salesStartAt) : undefined,
        salesEndAt: dados.salesEndAt ? new Date(dados.salesEndAt) : undefined,
      },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    const completo = await this.membership.encontrarPlano(this.contexto.require(), plano.id);

    return this.planoParaDto(completo!);
  }

  @Get('plans')
  @RequirePermissions('plan.read')
  async listarPlanos(): Promise<PlanoDto[]> {
    const planos = await this.membership.listarPlanos(this.contexto.require());

    return planos.map((p) => this.planoParaDto(p));
  }

  @Get('plans/:id')
  @RequirePermissions('plan.read')
  async detalharPlano(@Param('id') id: string): Promise<PlanoDto> {
    const plano = await this.membership.encontrarPlano(this.contexto.require(), id);

    if (!plano) throw new NotFoundException({ code: 'PLAN_NOT_FOUND' });

    return this.planoParaDto(plano);
  }

  /**
   * Ativa assinatura manual e devolve o direito derivado.
   *
   * A resposta inclui o entitlement de proposito: a recepcao precisa ver
   * "onde e quando o acesso vale" no mesmo passo, sem inferir do plano
   * (aceite da Slice 1.2).
   */
  @Post('subscriptions')
  @RequirePermissions('subscription.manage')
  async ativarAssinatura(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ subscriptionId: string; entitlement: EntitlementDto }> {
    const dados = esquemaDeAtivacao.parse(corpo);

    const { subscription, entitlement } = await this.membership.ativarAssinatura(
      this.contexto.require(),
      {
        studentId: dados.studentId,
        planId: dados.planId,
        startsAt: new Date(dados.startsAt),
        endsAt: new Date(dados.endsAt),
        reason: dados.reason,
      },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    const comJanelas = await this.membership.listarEntitlementsDoAluno(
      this.contexto.require(),
      dados.studentId,
    );

    const criado = comJanelas.find((e) => e.id === entitlement.id)!;

    return { subscriptionId: subscription.id, entitlement: this.entitlementParaDto(criado) };
  }

  @Post('subscriptions/:id/actions')
  @RequirePermissions('subscription.manage')
  async alterarAssinatura(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ id: string; status: string }> {
    const dados = esquemaDeAlteracao.parse(corpo);
    const contexto = this.contexto.require();

    const existente = await this.membership.encontrarAssinatura(contexto, id);
    if (!existente) throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND' });

    const assinatura = await this.membership.alterarAssinatura(
      contexto,
      id,
      dados.version,
      dados.action,
      dados.reason,
      requisicao.correlationId ?? 'sem-correlacao',
      new Date(),
    );

    // Existe (lido acima) e mesmo assim `updateMany` nao pegou: alguem
    // alterou entre a leitura e a escrita.
    if (!assinatura) throw new ConflitoDeVersaoError();

    return { id: assinatura.id, status: assinatura.status };
  }

  @Post('entitlements/courtesy')
  @RequirePermissions('subscription.manage')
  async concederCortesia(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<EntitlementDto> {
    const dados = esquemaDeCortesia.parse(corpo);
    const contexto = this.contexto.require();

    const entitlement = await this.membership.concederCortesia(
      contexto,
      {
        studentId: dados.studentId,
        gymUnitIds: dados.gymUnitIds,
        janelas: dados.janelas,
        startsAt: new Date(dados.startsAt),
        endsAt: new Date(dados.endsAt),
        reason: dados.reason,
      },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    const todos = await this.membership.listarEntitlementsDoAluno(contexto, dados.studentId);

    return this.entitlementParaDto(todos.find((e) => e.id === entitlement.id)!);
  }

  @Get('students/:id/entitlements')
  @RequirePermissions('student.read')
  async listarEntitlements(@Param('id') id: string): Promise<EntitlementDto[]> {
    const entitlements = await this.membership.listarEntitlementsDoAluno(
      this.contexto.require(),
      id,
    );

    return entitlements.map((e) => this.entitlementParaDto(e));
  }

  /**
   * Timeline administrativa com cursor opaco.
   *
   * O cursor e base64 de `occurredAt|id` -- opaco para o cliente nao passar
   * a construi-lo a mao e depender do formato interno.
   */
  @Get('students/:id/timeline')
  @RequirePermissions('student.read')
  async lerTimeline(
    @Param('id') id: string,
    @Query('limit') limite?: string,
    @Query('cursor') cursor?: string,
  ): Promise<{
    items: { id: string; type: string; occurredAt: string; payload: unknown }[];
    nextCursor: string | null;
  }> {
    const take = Math.min(Number(limite) || 20, 100);

    const eventos = await this.membership.lerTimeline(
      this.contexto.require(),
      id,
      take,
      this.decodificarCursor(cursor),
    );

    const ultimo = eventos.at(-1);

    return {
      items: eventos.map((e) => ({
        id: e.id,
        type: e.type,
        occurredAt: e.occurredAt.toISOString(),
        payload: e.payload,
      })),
      nextCursor:
        eventos.length === take && ultimo
          ? Buffer.from(`${ultimo.occurredAt.toISOString()}|${ultimo.id}`).toString('base64url')
          : null,
    };
  }

  private decodificarCursor(
    cursor?: string,
  ): { occurredAt: Date; id: string } | undefined {
    if (!cursor) return undefined;

    const [instante, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!instante || !id) return undefined;

    const occurredAt = new Date(instante);
    // Cursor corrompido vira "primeira pagina", nao erro 500: o cliente
    // perde a posicao, e nao a resposta.
    if (Number.isNaN(occurredAt.getTime())) return undefined;

    return { occurredAt, id };
  }

  private planoParaDto(plano: PlanoComRegras): PlanoDto {
    return {
      id: plano.id,
      name: plano.name,
      description: plano.description,
      isActive: plano.isActive,
      gymUnitIds: plano.units.map((u) => u.gymUnitId),
      janelas: plano.accessWindows.map((j) => ({
        gymUnitId: j.gymUnitId,
        dayOfWeek: j.dayOfWeek,
        startMinute: j.startMinute,
        endMinute: j.endMinute,
      })),
    };
  }

  private entitlementParaDto(entitlement: EntitlementComJanelas): EntitlementDto {
    return {
      id: entitlement.id,
      source: entitlement.source,
      status: entitlement.status,
      startsAt: entitlement.startsAt.toISOString(),
      endsAt: entitlement.endsAt.toISOString(),
      reason: entitlement.reason,
      subscriptionId: entitlement.subscriptionId,
      janelas: entitlement.unitWindows.map((j) => ({
        gymUnitId: j.gymUnitId,
        dayOfWeek: j.dayOfWeek,
        startMinute: j.startMinute,
        endMinute: j.endMinute,
      })),
    };
  }
}
