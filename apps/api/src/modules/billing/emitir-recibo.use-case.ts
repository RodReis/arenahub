import { Injectable } from '@nestjs/common';

import type { Prisma } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import { hashDoRecibo, type SnapshotDoRecibo } from './domain/recibo.js';

/**
 * Recibo nao fiscal. F16, `M2-FR-018`, INV-075.
 *
 * NAO E NOTA FISCAL, e o produto inteiro depende dessa distincao: o ArenaHub
 * nao emite documento fiscal (`docs/prd/README.md` §3). O documento diz
 * "RECIBO NAO FISCAL" em caixa alta no proprio corpo -- um recibo que PARECE
 * nota e pior que recibo nenhum, porque a academia o entregaria no lugar da
 * nota que ela ainda precisa emitir.
 *
 * SNAPSHOT, NAO VISTA: o conteudo e congelado na emissao. Renderizar lendo
 * invoice e aluno ao vivo faria o documento de marco mudar quando o aluno
 * trocasse de nome em agosto -- e recibo que muda depois de entregue nao prova
 * nada.
 */

export class PagamentoNaoEncontradoParaReciboError extends ErroDeDominio {
  constructor() {
    super('PAYMENT_NOT_FOUND', 404, 'pagamento nao encontrado');
  }
}

export class PagamentoNaoConfirmadoParaReciboError extends ErroDeDominio {
  constructor(status: string) {
    super(
      'BILLING_RECEIPT_REQUIRES_CONFIRMED_PAYMENT',
      409,
      `recibo exige pagamento confirmado; este esta em ${status}`,
    );
  }
}

export class ReciboNaoEncontradoError extends ErroDeDominio {
  constructor() {
    super('RECEIPT_NOT_FOUND', 404, 'recibo nao encontrado');
  }
}

export interface ReciboEmitido {
  readonly receiptId: string;
  readonly numero: number;
  readonly verificationHash: string;
  readonly snapshot: SnapshotDoRecibo;
}

@Injectable()
export class EmitirReciboUseCase {
  constructor(private readonly db: PrismaService) {}

  /**
   * Emite ou devolve o recibo do pagamento.
   *
   * IDEMPOTENTE POR DESENHO: chamar duas vezes devolve o MESMO documento, com
   * o mesmo numero. Emitir um segundo com numero novo faria parecer que o
   * aluno pagou duas vezes -- e a numeracao sequencial e justamente o que a
   * contabilidade usa para conferir quantidade.
   */
  async executar(
    contexto: TenantContext,
    entrada: { paymentId: string; agora: Date },
  ): Promise<ReciboEmitido> {
    const existente = await this.db.receipt.findFirst({
      where: { tenantId: contexto.tenantId, paymentId: entrada.paymentId },
      select: { id: true, number: true, verificationHash: true, snapshot: true },
    });

    if (existente) {
      return {
        receiptId: existente.id,
        numero: existente.number,
        verificationHash: existente.verificationHash,
        snapshot: existente.snapshot as unknown as SnapshotDoRecibo,
      };
    }

    // `comTenant` embora a raiz seja `payments`: o `select` traz `student`
    // por baixo de `invoice`, e `students` TEM politica RLS (F66). Fora de
    // transacao interceptada o `set_config` nunca aplica, e sob o role
    // restrito o aninhado vem NULO enquanto a raiz volta inteira -- o Prisma
    // tipa a relacao como nao-nula, entao nem o TypeScript nem o teste avisam
    // (issue #306). Aqui o dano seria recibo emitido sem o nome do aluno.
    const pagamento = await this.db.comTenant((tx) =>
      tx.payment.findFirst({
        where: { id: entrada.paymentId, tenantId: contexto.tenantId },
        select: {
          id: true,
          invoiceId: true,
          status: true,
          method: true,
          amountMinor: true,
          currency: true,
          paidAt: true,
          externalPaymentId: true,
          invoice: {
            select: {
              number: true,
              billingPeriod: true,
              items: { select: { description: true, quantity: true, totalMinor: true } },
              student: { select: { fullName: true, membershipNumber: true } },
            },
          },
          tenant: { select: { legalName: true } },
        },
      }),
    );

    if (!pagamento) {
      throw new PagamentoNaoEncontradoParaReciboError();
    }

    /**
     * SO PAGAMENTO CONFIRMADO vira recibo (INV-075). Emitir sobre um
     * `PENDING` daria ao aluno um comprovante de dinheiro que ainda nao
     * entrou -- e ele o mostraria na recepcao, com razao.
     *
     * `REFUNDED` tambem emite: o dinheiro entrou de fato, e o recibo daquele
     * momento continua verdadeiro. O estorno e um movimento posterior, nao
     * uma negacao do pagamento (INV-069).
     */
    if (pagamento.status !== 'CONFIRMED' && pagamento.status !== 'REFUNDED') {
      throw new PagamentoNaoConfirmadoParaReciboError(pagamento.status);
    }

    return this.db.$transaction(async (tx) => {
      const numero = await this.proximoNumero(tx, contexto.tenantId);

      const snapshot: SnapshotDoRecibo = {
        tipo: 'RECIBO NÃO FISCAL',
        numero,
        emitidoEm: entrada.agora.toISOString(),
        tenant: { nome: pagamento.tenant.legalName },
        pagador: {
          nome: pagamento.invoice.student.fullName,
          matricula: pagamento.invoice.student.membershipNumber,
        },
        invoice: {
          numero: pagamento.invoice.number,
          competencia: pagamento.invoice.billingPeriod.toISOString().slice(0, 10),
        },
        pagamento: {
          amountMinor: pagamento.amountMinor,
          currency: pagamento.currency,
          pagoEm: (pagamento.paidAt ?? entrada.agora).toISOString(),
          metodo: pagamento.method,
          referenciaFinal: pagamento.externalPaymentId?.slice(-6) ?? null,
        },
        itens: pagamento.invoice.items.map((i) => ({
          descricao: i.description,
          quantidade: i.quantity,
          totalMinor: i.totalMinor,
        })),
      };

      const verificationHash = hashDoRecibo(snapshot);

      const recibo = await tx.receipt.create({
        data: {
          tenantId: contexto.tenantId,
          paymentId: pagamento.id,
          invoiceId: pagamento.invoiceId,
          number: numero,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          verificationHash,
          issuedAt: entrada.agora,
        },
        select: { id: true },
      });

      return { receiptId: recibo.id, numero, verificationHash, snapshot };
    });
  }

  async consultar(contexto: TenantContext, receiptId: string): Promise<ReciboEmitido> {
    const recibo = await this.db.receipt.findFirst({
      where: { id: receiptId, tenantId: contexto.tenantId },
      select: { id: true, number: true, verificationHash: true, snapshot: true },
    });

    if (!recibo) {
      throw new ReciboNaoEncontradoError();
    }

    return {
      receiptId: recibo.id,
      numero: recibo.number,
      verificationHash: recibo.verificationHash,
      snapshot: recibo.snapshot as unknown as SnapshotDoRecibo,
    };
  }

  /**
   * Numeracao por tenant, com lock pessimista. Copia deliberada de
   * `BillingRepository.proximoNumero`, e pelas mesmas razoes: `COUNT(*) + 1`
   * reusa numero depois de qualquer remocao, e `SEQUENCE` do Postgres e global
   * -- o tenant B veria o volume do A.
   */
  private async proximoNumero(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    await tx.$executeRaw`
      INSERT INTO receipt_sequences (tenant_id, next_value, updated_at)
      VALUES (${tenantId}::uuid, 1, now())
      ON CONFLICT (tenant_id) DO NOTHING
    `;

    const travadas = await tx.$queryRaw<{ next_value: number }[]>`
      SELECT next_value FROM receipt_sequences
      WHERE tenant_id = ${tenantId}::uuid
      FOR UPDATE
    `;

    const sequencial = travadas[0]?.next_value ?? 1;

    await tx.$executeRaw`
      UPDATE receipt_sequences
      SET next_value = ${sequencial + 1}, updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid
    `;

    return sequencial;
  }
}
