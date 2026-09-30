import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import { AssinaturaNaoEncontradaError, BillingRepository, ConfiguracaoFinanceiraAusenteError } from './billing.repository.js';
import { mesesPagaveis, resolverLote, type InvoiceParaFaixa } from './domain/meses-pagaveis.js';
import { InvoiceInvalidaError } from './domain/invoice.js';

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
 * uma faixa continua de meses -- vencidos, corrente e ate 6 adiantados.
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
      ateCompetencia: Date;
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

    const invoicesAbertas = await this.db.invoice.findMany({
      where: { subscriptionId: entrada.subscriptionId, tenantId: contexto.tenantId, status: { in: ['OPEN', 'OVERDUE'] } },
    });

    const faixa = mesesPagaveis({
      // O `where` ja restringe a OPEN/OVERDUE; o Prisma so nao estreita o
      // tipo do campo `status` a partir de um filtro `in` (mesmo ajuste do
      // commit 88a013f na Task 1).
      invoices: invoicesAbertas as InvoiceParaFaixa[],
      agora: entrada.agora,
      endsAt: assinatura.endsAt,
      prices: assinatura.plan.prices,
      dueDay: configuracao.dueDay,
    });

    const lote = resolverLote(faixa, entrada.ateCompetencia);
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
            reason: `pagamento em lote ate ${entrada.ateCompetencia.toISOString().slice(0, 7)}`,
            paidAt: entrada.agora,
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
}

/**
 * Inclui `subscriptionId`: sem ele, duas assinaturas DIFERENTES reusando por
 * engano a mesma Idempotency-Key com o mesmo `ateCompetencia`/`channel`/
 * `expectedTotalMinor` fariam a segunda chamada devolver o lote da PRIMEIRA
 * como se fosse sucesso -- dinheiro contabilizado no aluno errado, em
 * silencio (issue #458, achado da revisao, fix round 1).
 *
 * Inclui tambem `receivedAmountMinor`: sem ele, o valor efetivamente recebido
 * poderia mudar sob a mesma chave sem re-checagem.
 */
function hashDoCorpo(entrada: {
  subscriptionId: string;
  ateCompetencia: Date;
  channel: string;
  expectedTotalMinor: number;
  receivedAmountMinor?: number;
}): string {
  return createHash('sha256')
    .update(
      `${entrada.subscriptionId}|${entrada.ateCompetencia.toISOString()}|${entrada.channel}|${entrada.expectedTotalMinor}|${entrada.receivedAmountMinor ?? ''}`,
    )
    .digest('hex');
}
