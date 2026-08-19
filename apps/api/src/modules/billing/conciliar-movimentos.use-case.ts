import { Inject, Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import {
  conciliar,
  contarEmAberto,
  type MovimentoExterno,
  type MovimentoInterno,
} from './domain/conciliacao.js';
import {
  ErroDoProvedor,
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './provider/payment-provider.port.js';

/**
 * Execucao de conciliacao. F16, `MVP-02` §7 (Slice 2.5), `M2-FR-019`.
 *
 * IMPORTA o extrato do provedor, casa contra o nosso lado e abre uma linha
 * para CADA movimento -- inclusive os que bateram. A metrica que o `MVP-02` §3
 * cobra e "100% dos movimentos reconciliaveis", e ela so e respondivel se o
 * que bateu tambem estiver gravado.
 *
 * SO LE do lado financeiro. Nenhuma invoice, pagamento ou entitlement muda
 * aqui: conciliar e CONSTATAR. Corrigir e a resolucao do item, que passa pelo
 * caminho idempotente de sempre -- nunca por um `UPDATE` de conveniencia.
 */

export class JanelaDeConciliacaoInvalidaError extends ErroDeDominio {
  constructor(motivo: string) {
    super('RECONCILIATION_INVALID_WINDOW', 422, motivo);
  }
}

export class ContaDeConciliacaoNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('PROVIDER_ACCOUNT_NOT_FOUND', 404, 'conta do provedor nao encontrada');
  }
}

export interface ResultadoDaConciliacao {
  readonly runId: string;
  readonly status: string;
  readonly movimentosImportados: number;
  readonly itensEmAberto: number;
  /** `true` quando a janela ja tinha sido conciliada e nada foi refeito. */
  readonly jaExistia: boolean;
}

@Injectable()
export class ConciliarMovimentosUseCase {
  constructor(
    private readonly db: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provedor: PaymentProvider,
  ) {}

  /**
   * `agora` entra por parametro (`CLAUDE.md`) porque a janela e validada
   * contra ele: conciliar periodo que ainda nao fechou produz divergencia
   * falsa, e o teste precisa fixar o instante para provar isso.
   */
  async executar(
    contexto: TenantContext,
    entrada: { providerAccountId: string; de: Date; ate: Date; agora: Date },
  ): Promise<ResultadoDaConciliacao> {
    if (entrada.ate.getTime() <= entrada.de.getTime()) {
      throw new JanelaDeConciliacaoInvalidaError('o fim da janela tem de ser depois do inicio');
    }

    /**
     * JANELA TEM DE ESTAR FECHADA.
     *
     * Conciliar ate "agora" acusaria `MISSING_EXTERNAL` em todo pagamento
     * recente: o provedor leva minutos a horas para publicar no extrato, e o
     * dinheiro que entrou ha um minuto ainda nao esta la. A divergencia
     * existiria no relatorio e nao no mundo -- e a operacao aprenderia a
     * ignorar a fila, que e o pior desfecho possivel para esta fatia.
     */
    if (entrada.ate.getTime() > entrada.agora.getTime()) {
      throw new JanelaDeConciliacaoInvalidaError(
        'a janela precisa estar fechada; conciliar periodo em curso produz divergencia falsa',
      );
    }

    const conta = await this.db.providerAccount.findFirst({
      where: { id: entrada.providerAccountId, tenantId: contexto.tenantId },
      select: { id: true, externalAccountId: true },
    });

    if (!conta) {
      throw new ContaDeConciliacaoNaoEncontradaError();
    }

    /**
     * REEXECUTAR A MESMA JANELA E IDEMPOTENTE (INV-086): devolve a execucao
     * que ja existe em vez de duplicar divergencia. Sem isto, o operador que
     * clica duas vezes veria a mesma pendencia duas vezes na fila e
     * "resolveria" uma delas, deixando a outra aberta para sempre.
     */
    const existente = await this.db.reconciliationRun.findFirst({
      where: {
        tenantId: contexto.tenantId,
        providerAccountId: conta.id,
        periodStart: entrada.de,
        periodEnd: entrada.ate,
      },
      select: { id: true, status: true, movementsImported: true, itemsOpen: true },
    });

    /**
     * `COMPLETED` devolve o resultado; `RUNNING` e `FAILED` reexecutam.
     *
     * `RUNNING` ENTRA NA REEXECUCAO por achado da revisao de codigo: se o
     * processo morrer entre criar a run e concluir a transacao, ela fica
     * `RUNNING` para sempre -- e tratar isso como "ja existe" faria toda
     * tentativa seguinte devolver a run travada, deixando aquela janela
     * impossivel de conciliar sem mexer no banco. Justo o que o aceite da
     * fatia proibe.
     *
     * Reexecutar e seguro (INV-086): a transacao limpa o resultado parcial
     * antes de gravar o novo.
     */
    if (existente && existente.status === 'COMPLETED') {
      return {
        runId: existente.id,
        status: existente.status,
        movimentosImportados: existente.movementsImported,
        itensEmAberto: existente.itemsOpen,
        jaExistia: true,
      };
    }

    const run =
      existente ??
      (await this.db.reconciliationRun.create({
        data: {
          tenantId: contexto.tenantId,
          providerAccountId: conta.id,
          periodStart: entrada.de,
          periodEnd: entrada.ate,
          status: 'RUNNING',
        },
        select: { id: true },
      }));

    let extrato: readonly Awaited<ReturnType<PaymentProvider['listMovements']>>[number][];

    try {
      extrato = await this.provedor.listMovements({
        externalAccountId: conta.externalAccountId,
        de: entrada.de,
        ate: entrada.ate,
      });
    } catch (erro) {
      /**
       * Provedor fora NAO deixa a execucao pendurada em `RUNNING`: uma run que
       * nunca termina bloquearia a proxima tentativa da mesma janela pela
       * unicidade, e a conciliacao daquele periodo ficaria impossivel.
       */
      if (erro instanceof ErroDoProvedor) {
        await this.db.reconciliationRun.update({
          where: { id: run.id },
          data: { status: 'FAILED', failureCode: erro.codigo, finishedAt: entrada.agora },
        });
      }

      throw erro;
    }

    const internos = await this.carregarLadoInterno(contexto, conta.externalAccountId, entrada);

    const externos: MovimentoExterno[] = extrato.map((m) => ({
      externalMovementId: m.externalMovementId,
      externalPaymentId: m.externalPaymentId,
      tipo: m.tipo,
      amountMinor: m.amountMinor,
      currency: m.currency,
    }));

    const itens = conciliar(internos, externos);
    const emAberto = contarEmAberto(itens);

    await this.db.$transaction(async (tx) => {
      // Reexecucao de janela que falhou: limpa o resultado parcial antes de
      // gravar o novo. Sem isso, os movimentos da tentativa anterior
      // colidiriam na unicidade de `external_movement_id`.
      await tx.reconciliationItem.deleteMany({ where: { tenantId: contexto.tenantId, runId: run.id } });
      await tx.externalMovement.deleteMany({ where: { tenantId: contexto.tenantId, runId: run.id } });

      for (const movimento of extrato) {
        await tx.externalMovement.create({
          data: {
            tenantId: contexto.tenantId,
            runId: run.id,
            externalMovementId: movimento.externalMovementId,
            externalPaymentId: movimento.externalPaymentId,
            externalAccountId: conta.externalAccountId,
            kind: movimento.tipo,
            amountMinor: movimento.amountMinor,
            currency: movimento.currency,
            occurredAt: movimento.occurredAt,
          },
        });
      }

      for (const item of itens) {
        await tx.reconciliationItem.create({
          data: {
            tenantId: contexto.tenantId,
            runId: run.id,
            status: item.status,
            paymentId: item.paymentId,
            refundId: item.refundId,
            externalMovementId: item.externalMovementId,
            internalAmountMinor: item.internalAmountMinor,
            externalAmountMinor: item.externalAmountMinor,
            recommendedAction: item.recommendedAction,
          },
        });
      }

      await tx.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          movementsImported: extrato.length,
          itemsOpen: emAberto,
          failureCode: null,
          finishedAt: entrada.agora,
        },
      });

      /**
       * Evento so quando HA divergencia -- `ReconciliationMismatchDetected`
       * do `MVP-02` §14. Emitir em toda execucao transformaria o alerta em
       * ruido, e alerta que sempre dispara e alerta que ninguem le.
       */
      if (emAberto > 0) {
        await tx.outboxEvent.create({
          data: {
            tenantId: contexto.tenantId,
            eventType: 'ReconciliationMismatchDetected',
            aggregateType: 'ReconciliationRun',
            aggregateId: run.id,
            payload: { itensEmAberto: emAberto, movimentosImportados: extrato.length },
          },
        });
      }
    });

    return {
      runId: run.id,
      status: 'COMPLETED',
      movimentosImportados: extrato.length,
      itensEmAberto: emAberto,
      jaExistia: false,
    };
  }

  /**
   * O nosso lado da conciliacao: pagamentos e estornos CONFIRMADOS na janela.
   *
   * So confirmados de proposito. Um pagamento `PENDING` nao e dinheiro que
   * entrou, e cobra-lo do extrato acusaria `MISSING_EXTERNAL` de uma cobranca
   * que o aluno simplesmente nao pagou.
   */
  private async carregarLadoInterno(
    contexto: TenantContext,
    externalAccountId: string,
    janela: { de: Date; ate: Date },
  ): Promise<MovimentoInterno[]> {
    const pagamentos = await this.db.payment.findMany({
      where: {
        tenantId: contexto.tenantId,
        providerAccountId: externalAccountId,
        status: { in: ['CONFIRMED', 'REFUNDED'] },
        paidAt: { gte: janela.de, lt: janela.ate },
      },
      select: {
        id: true,
        externalPaymentId: true,
        amountMinor: true,
        currency: true,
      },
    });

    const estornos = await this.db.refund.findMany({
      where: {
        tenantId: contexto.tenantId,
        status: 'CONFIRMED',
        settledAt: { gte: janela.de, lt: janela.ate },
        payment: { providerAccountId: externalAccountId },
      },
      select: {
        id: true,
        amountMinor: true,
        currency: true,
        payment: { select: { externalPaymentId: true } },
      },
    });

    return [
      ...pagamentos.map(
        (p): MovimentoInterno => ({
          id: p.id,
          externalPaymentId: p.externalPaymentId,
          tipo: 'PAYMENT',
          amountMinor: p.amountMinor,
          currency: p.currency,
        }),
      ),
      ...estornos.map(
        (r): MovimentoInterno => ({
          id: r.id,
          externalPaymentId: r.payment.externalPaymentId,
          tipo: 'REFUND',
          amountMinor: r.amountMinor,
          currency: r.currency,
        }),
      ),
    ];
  }
}
