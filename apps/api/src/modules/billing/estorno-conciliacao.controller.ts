import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';

import { MfaService } from '../auth/mfa.service.js';
import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import { ConciliarMovimentosUseCase } from './conciliar-movimentos.use-case.js';
import { EmitirReciboUseCase } from './emitir-recibo.use-case.js';
import { EstornarPagamentoUseCase } from './estornar-pagamento.use-case.js';
import { ObservarEstornoUseCase } from './observar-estorno.use-case.js';
import { ResolverDivergenciaUseCase } from './resolver-divergencia.use-case.js';

import type { Request } from 'express';

/**
 * Rotas de estorno, conciliacao e recibo. F16, `MVP-02` §13.
 *
 * CONTROLLER PROPRIO e nao mais rotas no `BillingController`: aquele ja tem
 * treze rotas e dez injecoes, e a Slice 2.5 traz outras cinco com um eixo
 * diferente -- estas sao a operacao FINANCEIRA (quem devolve dinheiro e quem
 * concilia), nao a cobranca. Juntar tudo faria um arquivo que ninguem le
 * inteiro, e `docs/CONVENTION.md` pede coesao.
 */

/**
 * Codigo TOTP para o step-up. INV-074: "estorno e pagamento manual exigem
 * step-up authentication conforme valor".
 *
 * SEIS DIGITOS, sempre string: TOTP com zero a esquerda (`012345`) vira
 * `12345` se alguem tratar como numero, e o codigo valido seria recusado uma
 * vez a cada dez.
 */
const codigoMfa = z.string().regex(/^[0-9]{6}$/);

const esquemaDeEstorno = z
  .object({
    amountMinor: z.number().int().positive(),
    reason: z.string().min(3).max(300),
    codigoMfa,
  })
  .strict();

const esquemaDeConciliacao = z
  .object({
    providerAccountId: z.uuid(),
    de: z.iso.datetime(),
    ate: z.iso.datetime(),
  })
  .strict();

const esquemaDeResolucao = z
  .object({
    comando: z.enum(['REPROCESS_PROVIDER_EVENT', 'ACCEPT_DOCUMENTED_DIFFERENCE']),
    reason: z.string().min(3).max(300),
  })
  .strict();

const esquemaDeFiltroDeItens = z
  .object({
    runId: z.uuid().optional(),
    status: z
      .enum(['MATCHED', 'MISSING_INTERNAL', 'MISSING_EXTERNAL', 'AMOUNT_MISMATCH', 'RESOLVED'])
      .optional(),
  })
  .strict();

export class StepUpNaoConfirmadoError extends ErroDeDominio {
  constructor() {
    /**
     * 403 e nao 401: a sessao e valida -- o que falta e a confirmacao extra
     * desta operacao especifica. Um 401 faria o cliente derrubar a sessao e
     * mandar a operadora fazer login de novo, que nao resolve nada.
     */
    super('BILLING_STEP_UP_REQUIRED', 403, 'confirme o codigo do aplicativo para estornar');
  }
}

interface EstornoDto {
  refundId: string;
  status: string;
  amountMinor: number;
  currency: string;
  politicaDeAcesso: string;
  acessoSuspenso: boolean;
}

interface ItemDeConciliacaoDto {
  id: string;
  runId: string;
  status: string;
  paymentId: string | null;
  refundId: string | null;
  externalMovementId: string | null;
  internalAmountMinor: number | null;
  externalAmountMinor: number | null;
  recommendedAction: string;
  resolution: string | null;
  resolutionReason: string | null;
  resolvedAt: string | null;
}

@Controller('api/v1')
export class EstornoConciliacaoController {
  constructor(
    private readonly estorno: EstornarPagamentoUseCase,
    private readonly observarEstorno: ObservarEstornoUseCase,
    private readonly conciliacao: ConciliarMovimentosUseCase,
    private readonly resolucao: ResolverDivergenciaUseCase,
    private readonly recibo: EmitirReciboUseCase,
    private readonly mfa: MfaService,
    private readonly db: PrismaService,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * `billing.refund` e permissao PROPRIA, nao `billing.manage`.
   *
   * Mesmo criterio de `billing.payment.manual` (F12) e `access.override`
   * (F9): devolver dinheiro e ato excepcional, e quem pode abrir uma invoice
   * nao precisa poder devolver o que ja foi pago. Reusar `billing.manage`
   * daria a permissao a todo mundo que administra cobranca.
   */
  @Post('payments/:id/refunds')
  @RequirePermissions('billing.refund')
  async estornar(
    @Param('id') paymentId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<EstornoDto> {
    const dados = esquemaDeEstorno.parse(corpo);
    const contexto = this.contexto.require();

    /**
     * STEP-UP ANTES DE QUALQUER EFEITO (INV-074). Verificar depois de gravar
     * o `Refund` deixaria o registro no banco de uma operacao que a pessoa
     * nao confirmou -- e o indice parcial travaria o estorno legitimo
     * seguinte.
     */
    try {
      await this.mfa.verificar(contexto.actorId, dados.codigoMfa);
    } catch {
      /**
       * Erro OPACO de proposito: distinguir "codigo errado" de "MFA nao
       * cadastrado" diz a quem tenta forcar onde esta a porta destrancada.
       */
      throw new StepUpNaoConfirmadoError();
    }

    const resultado = await this.estorno.executar(
      contexto,
      {
        paymentId,
        amountMinor: dados.amountMinor,
        reason: dados.reason,
        agora: new Date(),
      },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return {
      refundId: resultado.refundId,
      status: resultado.status,
      amountMinor: resultado.amountMinor,
      currency: resultado.currency,
      politicaDeAcesso: resultado.politicaDeAcesso,
      acessoSuspenso: resultado.acessoSuspenso,
    };
  }

  /**
   * Consulta ativa do estorno -- fecha o que ficou pendente no provedor.
   *
   * `billing.read` e nao `billing.refund`: consultar nao decide nada sobre
   * dinheiro. O desfecho quem decide e o provedor; esta rota so pergunta e
   * aplica o que ele responder. Exigir a permissao de estornar aqui impediria
   * a conferencia diaria de destravar um estorno preso.
   */
  @Post('refunds/:id/observe')
  @RequirePermissions('billing.read')
  async observar(
    @Param('id') refundId: string,
    @Req() requisicao: Request,
  ): Promise<{ refundId: string; status: string; mudou: boolean; acessoSuspenso: boolean }> {
    return this.observarEstorno.executar(
      this.contexto.require(),
      { refundId, agora: new Date() },
      requisicao.correlationId ?? 'sem-correlacao',
    );
  }

  @Post('reconciliation/runs')
  @RequirePermissions('reconciliation.resolve')
  async conciliar(@Body() corpo: unknown): Promise<{
    runId: string;
    status: string;
    movimentosImportados: number;
    itensEmAberto: number;
    jaExistia: boolean;
  }> {
    const dados = esquemaDeConciliacao.parse(corpo);

    return this.conciliacao.executar(this.contexto.require(), {
      providerAccountId: dados.providerAccountId,
      de: new Date(dados.de),
      ate: new Date(dados.ate),
      agora: new Date(),
    });
  }

  @Get('reconciliation/items')
  @RequirePermissions('reconciliation.read')
  async listarItens(@Query() consulta: unknown): Promise<ItemDeConciliacaoDto[]> {
    const filtro = esquemaDeFiltroDeItens.parse(consulta);
    const contexto = this.contexto.require();

    const itens = await this.db.reconciliationItem.findMany({
      where: {
        tenantId: contexto.tenantId,
        ...(filtro.runId ? { runId: filtro.runId } : {}),
        ...(filtro.status ? { status: filtro.status } : {}),
      },
      /**
       * Divergencia aberta primeiro, mais antiga no topo. Ordenar so por data
       * enterraria a pendencia de hoje sob as resolvidas de ontem -- e a fila
       * existe para ser esvaziada, nao navegada.
       */
      orderBy: [{ resolvedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: 200,
    });

    return itens.map((i) => ({
      id: i.id,
      runId: i.runId,
      status: i.status,
      paymentId: i.paymentId,
      refundId: i.refundId,
      externalMovementId: i.externalMovementId,
      internalAmountMinor: i.internalAmountMinor,
      externalAmountMinor: i.externalAmountMinor,
      recommendedAction: i.recommendedAction,
      resolution: i.resolution,
      resolutionReason: i.resolutionReason,
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
    }));
  }

  @Post('reconciliation/items/:id/resolve')
  @RequirePermissions('reconciliation.resolve')
  async resolver(
    @Param('id') itemId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ itemId: string; comando: string; eventoAplicado: boolean | null }> {
    const dados = esquemaDeResolucao.parse(corpo);

    return this.resolucao.executar(
      this.contexto.require(),
      { itemId, comando: dados.comando, reason: dados.reason, agora: new Date() },
      requisicao.correlationId ?? 'sem-correlacao',
    );
  }

  /**
   * `receipt.issue` e nao `receipt.read`: emitir CONSOME numero sequencial
   * imutavel do tenant (INV-075), e numeracao gasta nao volta. Autorizar uma
   * escrita com a permissao de leitura quebraria a simetria que o resto do
   * modulo estabelece -- `billing.refund` e separada de `billing.manage` pela
   * mesma razao. Achado na revisao de codigo.
   */
  @Post('payments/:id/receipt')
  @RequirePermissions('receipt.issue')
  async emitirRecibo(@Param('id') paymentId: string) {
    return this.recibo.executar(this.contexto.require(), { paymentId, agora: new Date() });
  }

  @Get('receipts/:id')
  @RequirePermissions('receipt.read')
  async consultarRecibo(@Param('id') receiptId: string) {
    return this.recibo.consultar(this.contexto.require(), receiptId);
  }
}
