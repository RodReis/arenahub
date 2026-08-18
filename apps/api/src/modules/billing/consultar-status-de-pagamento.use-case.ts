import { Inject, Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  ErroDoProvedor,
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type StatusNoProvedor,
} from './provider/payment-provider.port.js';

/**
 * Consulta ativa do status de um pagamento. `MVP-02` 7 e 13, Slice 2.2:
 * "inbox idempotente e CONSULTA ATIVA de confirmacao quando necessaria".
 *
 * POR QUE EXISTE, se ja ha webhook: webhook e entrega best-effort. Ele
 * atrasa, cai em fila do provedor, e a recepcao fica com o aluno na frente
 * dela perguntando por que a catraca nao abriu. A consulta ativa e o caminho
 * de quem nao pode esperar.
 *
 * SO LE -- NAO CONFIRMA NADA. Deliberado: confirmar por aqui criaria um
 * SEGUNDO caminho de escrita para a mesma transicao, e dois caminhos
 * concorrentes para "invoice paga" e exatamente o que INV-076 existe para
 * impedir. Quem escreve e o webhook, uma vez, com a constraint atras.
 *
 * A divergencia entre o nosso estado e o do provedor e DEVOLVIDA, nao
 * escondida: `divergente: true` e o sinal para a recepcao acionar a
 * conciliacao (Slice 2.5) em vez de clicar de novo.
 */

export class TentativaNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('PAYMENT_ATTEMPT_NOT_FOUND', 404, 'Tentativa de pagamento nao encontrada');
  }
}

export class ConsultaAoProvedorFalhouError extends ErroDeDominio {
  constructor(codigo: string, recuperavel: boolean) {
    super(
      'PROVIDER_QUERY_FAILED',
      recuperavel ? 503 : 422,
      `Nao foi possivel consultar o provedor (${codigo})`,
    );
  }
}

export interface StatusDePagamento {
  paymentAttemptId: string;
  invoiceId: string;
  externalPaymentId: string;
  /** O que o NOSSO banco diz. */
  statusLocal: string;
  /** O que o PROVEDOR diz agora. */
  statusNoProvedor: StatusNoProvedor;
  /**
   * `true` quando o provedor ja confirmou e nos ainda nao. Significa webhook
   * atrasado ou perdido -- caso de conciliacao, nao de clicar de novo.
   */
  divergente: boolean;
  occurredAt: Date;
}

@Injectable()
export class ConsultarStatusDePagamentoUseCase {
  constructor(
    private readonly db: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provedor: PaymentProvider,
  ) {}

  async executar(
    contexto: TenantContext,
    paymentAttemptId: string,
  ): Promise<StatusDePagamento> {
    /**
     * Escopo do tenant no `where`, sempre (regra de arquitetura no 2). Sem
     * ele, um id de outro tenant devolveria o estado financeiro de quem nao
     * perguntou -- e pior, consultaria o provedor por ele.
     */
    const tentativa = await this.db.paymentAttempt.findFirst({
      where: { id: paymentAttemptId, tenantId: contexto.tenantId },
      include: { payment: true },
    });

    if (!tentativa?.externalPaymentId) {
      throw new TentativaNaoEncontradaError();
    }

    let noProvedor;

    try {
      noProvedor = await this.provedor.getPaymentStatus(tentativa.externalPaymentId);
    } catch (erro) {
      if (erro instanceof ErroDoProvedor) {
        throw new ConsultaAoProvedorFalhouError(erro.codigo, erro.recuperavel);
      }

      throw erro;
    }

    const statusLocal = tentativa.payment?.status ?? 'PENDING';

    return {
      paymentAttemptId: tentativa.id,
      invoiceId: tentativa.invoiceId,
      externalPaymentId: tentativa.externalPaymentId,
      statusLocal,
      statusNoProvedor: noProvedor.status,
      divergente: noProvedor.status === 'CONFIRMED' && statusLocal !== 'CONFIRMED',
      occurredAt: noProvedor.occurredAt,
    };
  }
}
