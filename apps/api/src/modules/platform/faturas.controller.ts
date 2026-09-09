import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import type { PlatformInvoice } from '@arenahub/database';

import { PlatformContextService } from '../../common/platform/platform-context.service.js';
import { PlatformRoute } from '../../common/security/platform-route.decorator.js';
import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import {
  esquemaDeEmissaoDeFatura,
  esquemaDeRegistroDePagamento,
} from './dto/platform-invoice.dto.js';
import { PlatformInvoiceUseCase, type PreviaDaFatura } from './platform-invoice.use-case.js';

const ESQUEMA_DA_FATURA = {
  type: 'object',
  required: ['id', 'tenantId', 'competencia', 'model', 'totalMinor', 'currency', 'status'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    contractId: { type: 'string', format: 'uuid' },
    competencia: { type: 'string' },
    model: { type: 'string', enum: ['PER_STUDENT', 'FIXED_MONTHLY'] },
    activeCount: { type: 'integer' },
    inactiveCount: { type: 'integer' },
    activeStudentPriceMinor: { type: 'integer', nullable: true },
    inactiveStudentPriceMinor: { type: 'integer', nullable: true },
    totalMinor: { type: 'integer' },
    currency: { type: 'string' },
    dueAt: { type: 'string', format: 'date-time' },
    status: { type: 'string', enum: ['OPEN', 'PAID', 'OVERDUE'] },
    paidAt: { type: 'string', format: 'date-time', nullable: true },
  },
};

const ESQUEMA_DA_PREVIA = {
  type: 'object',
  required: ['competencia', 'emiteEm', 'totalMinor', 'jaEmitida'],
  properties: {
    competencia: { type: 'string' },
    emiteEm: { type: 'string', format: 'date-time' },
    vencimento: { type: 'string', format: 'date-time' },
    model: { type: 'string' },
    activeCount: { type: 'integer' },
    inactiveCount: { type: 'integer' },
    activeStudentPriceMinor: { type: 'integer', nullable: true },
    inactiveStudentPriceMinor: { type: 'integer', nullable: true },
    totalMinor: { type: 'integer' },
    currency: { type: 'string' },
    jaEmitida: { type: 'boolean' },
  },
};

/** A fatura como o painel a le. */
interface FaturaNaResposta {
  id: string;
  tenantId: string;
  contractId: string;
  competencia: string;
  model: string;
  activeCount: number;
  inactiveCount: number;
  activeStudentPriceMinor: number | null;
  inactiveStudentPriceMinor: number | null;
  totalMinor: number;
  currency: string;
  dueAt: string;
  status: string;
  paidAt: string | null;
}

/**
 * `competencia` como `AAAA-MM`, e nao a data crua.
 *
 * A coluna e `@db.Date` e o mes e o que significa: devolver
 * `2026-03-01T00:00:00.000Z` convida o cliente a formatar com o fuso local, e
 * em Sao Paulo isso imprime fevereiro.
 */
function paraResposta(fatura: PlatformInvoice): FaturaNaResposta {
  return {
    id: fatura.id,
    tenantId: fatura.tenantId,
    contractId: fatura.contractId,
    competencia: fatura.competence.toISOString().slice(0, 7),
    model: fatura.model,
    activeCount: fatura.activeCount,
    inactiveCount: fatura.inactiveCount,
    activeStudentPriceMinor: fatura.activeStudentPriceMinor,
    inactiveStudentPriceMinor: fatura.inactiveStudentPriceMinor,
    totalMinor: fatura.totalMinor,
    currency: fatura.currency,
    dueAt: fatura.dueAt.toISOString(),
    status: fatura.status,
    paidAt: fatura.paidAt?.toISOString() ?? null,
  };
}

/**
 * Fatura da plataforma, lado do Super Admin -- F64, ADR-052.
 *
 * `@PlatformRoute()` na classe pela mesma razao do `ContratosController`:
 * rota nova nasce protegida. A previa do OWNER NAO mora aqui -- ela e do
 * tenant, e esta em `PreviaDeFaturaController`.
 */
@Controller('api/v1/platform')
@PlatformRoute()
export class FaturasController {
  constructor(
    private readonly contexto: PlatformContextService,
    private readonly faturas: PlatformInvoiceUseCase,
  ) {}

  @Get('tenants/:tenantId/invoices')
  @ApiOkResponse({ schema: { type: 'array', items: ESQUEMA_DA_FATURA } })
  async listar(@Param('tenantId') tenantId: string): Promise<FaturaNaResposta[]> {
    const encontradas = await this.faturas.listarDoTenant(tenantId);

    return encontradas.map(paraResposta);
  }

  @Get('tenants/:tenantId/invoices/preview')
  @ApiOkResponse({ schema: ESQUEMA_DA_PREVIA })
  async previa(@Param('tenantId') tenantId: string): Promise<PreviaDaFatura> {
    return this.faturas.previa(tenantId, new Date());
  }

  /**
   * Emite a fatura da competencia corrente fora do dia agendado.
   *
   * IDEMPOTENTE: a competencia ja faturada devolve a MESMA fatura, com a
   * contagem que ela congelou -- nao uma segunda, nem a mesma recalculada.
   */
  @Post('invoices')
  @ApiCreatedResponse({ schema: ESQUEMA_DA_FATURA })
  async emitir(@Body() corpo: unknown, @Req() requisicao: Request): Promise<FaturaNaResposta> {
    const dados = esquemaDeEmissaoDeFatura.parse(corpo);

    const { fatura } = await this.faturas.emitir(
      dados.tenantId,
      dados.emitirEm ? new Date(dados.emitirEm) : new Date(),
      this.contexto.require(),
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return paraResposta(fatura);
  }

  /** Pagamento MANUAL: nao ha gateway para a plataforma nesta versao. */
  @Post('invoices/:id/payment')
  @ApiOkResponse({ schema: ESQUEMA_DA_FATURA })
  async registrarPagamento(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<FaturaNaResposta> {
    const dados = esquemaDeRegistroDePagamento.parse(corpo);

    const fatura = await this.faturas.registrarPagamento(
      this.contexto.require(),
      id,
      dados.pagoEm ? new Date(dados.pagoEm) : new Date(),
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return paraResposta(fatura);
  }
}

/**
 * A previa e as faturas do PROPRIO tenant -- lado do OWNER, ADR-052.
 *
 * ---------------------------------------------------------------------------
 * CONTROLLER SEPARADO, e a separacao e a protecao.
 * ---------------------------------------------------------------------------
 *
 * O outro e `@PlatformRoute()` na classe: exclusivo do dono do SaaS. Estas
 * rotas sao do CONTRATANTE olhando a propria conta, e uma delas dentro
 * daquela classe seria a excecao que o proximo autor herda como duvida -- ou,
 * pior, uma rota de tenant que silenciosamente exige ser Super Admin.
 *
 * O `tenantId` vem do CONTEXTO AUTENTICADO e nunca da URL (regra de
 * arquitetura no 2): recebe-lo por parametro deixaria o OWNER de uma academia
 * ler a fatura de outra trocando um uuid.
 */
@Controller('api/v1/billing/platform')
export class PreviaDeFaturaController {
  constructor(
    private readonly contexto: TenantContextService,
    private readonly faturas: PlatformInvoiceUseCase,
  ) {}

  /**
   * A previa da propria fatura -- a mitigacao que o PI aceitou (ADR-052,
   * riscos): o tenant ve o numero antes de ele virar cobranca.
   *
   * `tenant.read` e nao `billing.manage`: o financeiro do tenant cuida da
   * cobranca do ALUNO, e esta e a conta da academia com o ArenaHub -- outro
   * assunto, e quem responde por ele e quem responde pela academia.
   */
  @Get('preview')
  @RequirePermissions('tenant.read')
  @ApiOkResponse({ schema: ESQUEMA_DA_PREVIA })
  async previa(): Promise<PreviaDaFatura> {
    return this.faturas.previa(this.contexto.require().tenantId, new Date());
  }

  @Get('invoices')
  @RequirePermissions('tenant.read')
  @ApiOkResponse({ schema: { type: 'array', items: ESQUEMA_DA_FATURA } })
  async listar(): Promise<FaturaNaResposta[]> {
    const encontradas = await this.faturas.listarDoTenant(this.contexto.require().tenantId);

    return encontradas.map(paraResposta);
  }
}
