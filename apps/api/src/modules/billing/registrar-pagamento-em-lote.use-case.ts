import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import { AssinaturaNaoEncontradaError, BillingRepository, ConfiguracaoFinanceiraAusenteError } from './billing.repository.js';
import { instanteDeBloqueio } from './domain/ciclo-de-cobranca.js';
import {
  instanteDoPagamento,
  mesesPagaveis,
  resolverDispensa,
  resolverLote,
  vencimentoAposPagamento,
  type InvoiceParaFaixa,
} from './domain/meses-pagaveis.js';
import { InvoiceInvalidaError } from './domain/invoice.js';

const MESES_A_FRENTE_PARA_ANCORAR = 7;

export class TotalDoLoteDivergenteError extends ErroDeDominio {
  constructor() {
    super('BILLING_BATCH_TOTAL_CHANGED', 409, 'o total do lote mudou desde que a tela foi carregada');
  }
}

export class IdempotencyKeyComCorpoDiferenteError extends ErroDeDominio {
  constructor() {
    super('BILLING_BATCH_IDEMPOTENCY_MISMATCH', 422, 'esta Idempotency-Key ja foi usada com um pedido diferente');
  }
}

export interface ResultadoDoLote {
  readonly batchId: string;
  readonly invoiceIds: string[];
  readonly totalMinor: number;
}

/**
 * Pagamento em lote no balcao (F83, issue #458): quita, numa transacao so,
 * os meses que a recepcao escolher da faixa -- vencidos, corrente e ate 6
 * adiantados, em qualquer combinacao ("pagou usou", decisao do PI 01/10/2026).
 *
 * A recepcao informa a DATA do pagamento. A vigencia conta dela: a proxima
 * fatura em aberto depois do ultimo mes pago passa a vencer em
 * `data + 30 dias por mes pago`, e o bloqueio continua sendo vencimento +
 * carencia. Mes anterior nao usado pode ser DISPENSADO na hora (CANCELLED);
 * o que a recepcao nao dispensa nem paga segue em aberto.
 *
 * Reaproveita `abrirInvoiceDoPeriodo` e `registrarPagamentoManual` do
 * `BillingRepository`, passando o MESMO `tx` para as duas -- e o que faz o
 * lote inteiro ser atomico (falha em qualquer mes desfaz todos).
 */
@Injectable()
export class RegistrarPagamentoEmLoteUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly billing: BillingRepository,
  ) {}

  async executar(
    contexto: TenantContext,
    entrada: {
      subscriptionId: string;
      competencias: Date[];
      dispensar: Date[];
      /** So o DIA (meia-noite UTC) informado pela recepcao. */
      paidAt: Date;
      channel: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';
      expectedTotalMinor: number;
      receivedAmountMinor?: number;
      idempotencyKey: string;
      agora: Date;
    },
    correlationId: string,
  ): Promise<ResultadoDoLote> {
    const corpoHash = hashDoCorpo(entrada);

    /**
     * Idempotencia: procura o Payment que carrega o hash do PRIMEIRO pedido
     * deste batchId. So esse Payment tem `batchRequestHash` preenchido -- os
     * demais do mesmo lote ficam com o campo nulo (ver comentario onde ele e
     * gravado, mais abaixo) -- entao o filtro `not: null` e obrigatorio: sem
     * ele, o Postgres pode devolver qualquer linha do lote, inclusive uma com
     * hash nulo, e `null !== corpoHash` rejeitaria um replay legitimo com o
     * MESMO corpo (issue #458, achado da revisao, fix round 1).
     */
    const existente = await this.db.payment.findFirst({
      where: { tenantId: contexto.tenantId, batchId: entrada.idempotencyKey, batchRequestHash: { not: null } },
      select: { batchId: true, batchRequestHash: true, invoiceId: true, amountMinor: true },
    });

    if (existente) {
      if (existente.batchRequestHash !== corpoHash) {
        throw new IdempotencyKeyComCorpoDiferenteError();
      }

      const pagamentosDoLote = await this.db.payment.findMany({
        where: { tenantId: contexto.tenantId, batchId: entrada.idempotencyKey },
        select: { invoiceId: true, amountMinor: true },
      });

      return {
        batchId: entrada.idempotencyKey,
        invoiceIds: pagamentosDoLote.map((p) => p.invoiceId),
        totalMinor: pagamentosDoLote.reduce((soma, p) => soma + p.amountMinor, 0),
      };
    }

    const assinatura = await this.db.subscription.findFirst({
      where: { id: entrada.subscriptionId, tenantId: contexto.tenantId },
      include: { plan: { include: { prices: true } } },
    });

    if (!assinatura) {
      throw new AssinaturaNaoEncontradaError();
    }

    const configuracao = await this.db.billingSettings.findUnique({
      where: { tenantId: contexto.tenantId },
    });

    if (!configuracao) {
      throw new ConfiguracaoFinanceiraAusenteError();
    }

    // Todas as invoices, em qualquer status: mes ja pago/cancelado/estornado
    // fica fora da faixa e, portanto, nao pode ser pago de novo.
    const invoicesDaAssinatura = await this.db.invoice.findMany({
      where: { subscriptionId: entrada.subscriptionId, tenantId: contexto.tenantId },
    });

    const faixa = mesesPagaveis({
      invoices: invoicesDaAssinatura as InvoiceParaFaixa[],
      agora: entrada.agora,
      endsAt: assinatura.endsAt,
      prices: assinatura.plan.prices,
      dueDay: configuracao.dueDay,
    });

    const lote = resolverLote(faixa, entrada.competencias);
    const dispensadas = resolverDispensa(faixa, lote, entrada.dispensar);
    const instanteDoRecebimento = instanteDoPagamento(entrada.paidAt, entrada.agora);
    const totalCalculado = lote.reduce((soma, mes) => soma + mes.totalMinor, 0);

    if (totalCalculado !== entrada.expectedTotalMinor) {
      throw new TotalDoLoteDivergenteError();
    }

    /**
     * Subpagamento nao existe no lote, pela MESMA regra que ja vale para
     * invoice unica (ADR-027 resposta 1, `aplicarPagamento` em
     * `domain/invoice.ts`): reaproveita `InvoiceInvalidaError`, nao inventa
     * codigo novo (achado da revisao, fix round 1).
     */
    if (entrada.receivedAmountMinor !== undefined && entrada.receivedAmountMinor < totalCalculado) {
      throw new InvoiceInvalidaError(
        'pagamento parcial nao e aceito no MVP 2; o lote so fecha com o valor integral',
      );
    }

    const invoiceIds: string[] = [];

    await this.db.$transaction(async (tx) => {
      // Guarda o ultimo Payment criado no lote e a moeda da ultima invoice --
      // o excedente (troco de sobrepagamento) precisa de `originPaymentId`
      // rastreavel (schema exige a coluna preenchida, nao aceita `null`) e da
      // moeda REAL da invoice, nao de um valor arbitrario do catalogo de
      // precos (achado da revisao, fix round 1).
      let ultimoPagamentoId: string | null = null;
      let ultimaMoeda: string | null = null;

      for (const mes of lote) {
        const invoice = mes.invoiceId
          ? await tx.invoice.findUniqueOrThrow({ where: { id: mes.invoiceId, tenantId: contexto.tenantId } })
          : await this.billing.abrirInvoiceDoPeriodo(contexto, { subscriptionId: entrada.subscriptionId, emQue: mes.competencia }, tx);

        const pagamento = await this.billing.registrarPagamentoManual(
          contexto,
          {
            invoiceId: invoice.id,
            amountMinor: mes.totalMinor,
            reason: `pagamento em lote: ${lote.map((m) => m.competencia.toISOString().slice(0, 7)).join(', ')}`,
            paidAt: instanteDoRecebimento,
            receivedVia: entrada.channel,
            batchId: entrada.idempotencyKey,
          },
          correlationId,
          tx,
        );

        invoiceIds.push(invoice.id);
        ultimoPagamentoId = pagamento.id;
        ultimaMoeda = invoice.currency;

        // So o PRIMEIRO Payment do lote carrega o hash -- e o que a
        // checagem de idempotencia acima consulta.
        if (invoiceIds.length === 1) {
          await tx.payment.update({ where: { id: pagamento.id }, data: { batchRequestHash: corpoHash } });
        }
      }

      for (const mes of dispensadas) {
        await this.dispensarInvoice(tx, contexto, mes.invoiceId!, correlationId);
      }

      await this.ancorarProximoVencimento(tx, contexto, {
        subscriptionId: entrada.subscriptionId,
        ultimoMesPago: lote[lote.length - 1]!.competencia,
        vencimento: vencimentoAposPagamento(entrada.paidAt, lote.length),
        graceDays: configuracao.graceDays,
        endsAt: assinatura.endsAt,
        agora: entrada.agora,
      });

      const excedente = (entrada.receivedAmountMinor ?? totalCalculado) - totalCalculado;

      if (excedente > 0 && ultimoPagamentoId && ultimaMoeda) {
        await tx.accountCredit.create({
          data: {
            tenantId: contexto.tenantId,
            studentId: assinatura.studentId,
            originPaymentId: ultimoPagamentoId,
            amountMinor: excedente,
            currency: ultimaMoeda,
          },
        });
      }
    });

    return { batchId: entrada.idempotencyKey, invoiceIds, totalMinor: totalCalculado };
  }

  /** Mes nao usado: a fatura sai da inadimplencia e fica no historico como CANCELLED. */
  private async dispensarInvoice(
    tx: Prisma.TransactionClient,
    contexto: TenantContext,
    invoiceId: string,
    correlationId: string,
  ): Promise<void> {
    const { count } = await tx.invoice.updateMany({
      where: { id: invoiceId, tenantId: contexto.tenantId, status: { in: ['OPEN', 'OVERDUE'] } },
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });

    if (count === 0) return;

    await tx.auditLog.create({
      data: {
        tenantId: contexto.tenantId,
        actorType: 'USER',
        actorId: contexto.actorId,
        action: 'billing.invoice.dispensed',
        target: 'Invoice',
        targetId: invoiceId,
        correlationId,
        metadata: { reason: 'mes nao usado (pagou e usou)' },
      },
    });
  }

  /**
   * A primeira fatura ainda devida DEPOIS do ultimo mes pago passa a vencer no
   * fim da vigencia paga. Abre a fatura se ainda nao existir. Fatura ja
   * paga/cancelada e pulada: a vigencia vale para a proxima que ainda deve.
   */
  private async ancorarProximoVencimento(
    tx: Prisma.TransactionClient,
    contexto: TenantContext,
    entrada: {
      subscriptionId: string;
      ultimoMesPago: Date;
      vencimento: Date;
      graceDays: number;
      endsAt: Date | null;
      agora: Date;
    },
  ): Promise<void> {
    for (let i = 1; i <= MESES_A_FRENTE_PARA_ANCORAR; i += 1) {
      const periodo = new Date(
        Date.UTC(entrada.ultimoMesPago.getUTCFullYear(), entrada.ultimoMesPago.getUTCMonth() + i, 1),
      );

      if (entrada.endsAt && periodo.getTime() >= entrada.endsAt.getTime()) return;

      const existente = await tx.invoice.findUnique({
        where: {
          tenantId_subscriptionId_billingPeriod: {
            tenantId: contexto.tenantId,
            subscriptionId: entrada.subscriptionId,
            billingPeriod: periodo,
          },
        },
      });

      if (existente && existente.status !== 'OPEN' && existente.status !== 'OVERDUE') continue;

      const alvo =
        existente ??
        (await this.billing.abrirInvoiceDoPeriodo(
          contexto,
          { subscriptionId: entrada.subscriptionId, emQue: periodo },
          tx,
        ));

      await tx.invoice.update({
        where: { id: alvo.id },
        data: {
          dueAt: entrada.vencimento,
          blockAt: instanteDeBloqueio(entrada.vencimento, entrada.graceDays),
          // Vigencia nova reabre o prazo: OVERDUE com vencimento futuro volta a OPEN.
          status: entrada.vencimento.getTime() > entrada.agora.getTime() ? 'OPEN' : alvo.status,
          version: { increment: 1 },
        },
      });

      return;
    }
  }
}

/**
 * Inclui `subscriptionId`: sem ele, duas assinaturas DIFERENTES reusando por
 * engano a mesma Idempotency-Key com os mesmos meses/`channel`/
 * `expectedTotalMinor` fariam a segunda chamada devolver o lote da PRIMEIRA
 * como se fosse sucesso -- dinheiro contabilizado no aluno errado, em
 * silencio (issue #458, achado da revisao, fix round 1).
 *
 * Inclui tambem `receivedAmountMinor`, os meses (ordenados), os dispensados e
 * a data do pagamento: qualquer um deles mudando sob a mesma chave tem de ser
 * recusado, nao respondido com o lote antigo.
 */
function hashDoCorpo(entrada: {
  subscriptionId: string;
  competencias: Date[];
  dispensar: Date[];
  paidAt: Date;
  channel: string;
  expectedTotalMinor: number;
  receivedAmountMinor?: number;
}): string {
  const meses = (datas: Date[]): string =>
    datas
      .map((d) => d.toISOString())
      .sort()
      .join(',');

  return createHash('sha256')
    .update(
      `${entrada.subscriptionId}|${meses(entrada.competencias)}|${meses(entrada.dispensar)}|${entrada.paidAt.toISOString()}|${entrada.channel}|${entrada.expectedTotalMinor}|${entrada.receivedAmountMinor ?? ''}`,
    )
    .digest('hex');
}
