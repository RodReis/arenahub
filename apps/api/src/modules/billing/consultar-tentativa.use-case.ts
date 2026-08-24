import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

export class TentativaObservadaNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('PAYMENT_ATTEMPT_NOT_FOUND', 404, 'Tentativa de pagamento nao encontrada');
  }
}

export interface TentativaObservada {
  paymentAttemptId: string;
  status: string;
  invoiceStatus: string;
  paidAt: Date | null;
  receiptId: string | null;
}

/**
 * Leitura barata da tentativa, para o LACO da tela do balcao.
 *
 * SO O NOSSO BANCO -- que e onde o webhook ja escreveu. Nao injeta
 * `PAYMENT_PROVIDER` de proposito: a dependencia ausente e a garantia de que
 * ninguem acrescenta a chamada externa sem perceber.
 *
 * POR QUE NAO REUSAR `GET /payments/:id/status`
 * (`ConsultarStatusDePagamentoUseCase`): aquela consulta o provedor a cada
 * chamada -- "o caminho de quem nao pode esperar", escrita para o
 * excepcional, nao para o laco. Polling nela custaria ~20 chamadas externas
 * por minuto de QR aberto, por caixa; Sicoob e Getnet cobram e limitam por
 * taxa, e o `FakePaymentProvider` nao tem limite nenhum -- e por isso o
 * desenho errado passa verde em dev e so quebra em producao. Ela continua
 * existindo como CONSULTA ATIVA, o botao "Conferir com o banco".
 *
 * `expiresAt` NAO ENTRA aqui de proposito: `payment_attempts` nao tem coluna
 * de expiracao, e o valor ja viajou para a tela na resposta de criacao da
 * cobranca (`CobrancaPixDto.expiresAt`). Devolver de novo aqui exigiria
 * coluna nova so para repetir o que a criacao ja entregou -- dado duplicado
 * que pode divergir.
 */
@Injectable()
export class ConsultarTentativaUseCase {
  constructor(private readonly db: PrismaService) {}

  async executar(
    contexto: TenantContext,
    paymentAttemptId: string,
  ): Promise<TentativaObservada> {
    /** Escopo do tenant no `where`, sempre (regra de arquitetura no 2). */
    const tentativa = await this.db.paymentAttempt.findFirst({
      where: { id: paymentAttemptId, tenantId: contexto.tenantId },
      include: {
        invoice: { select: { status: true, paidAt: true } },
        payment: { select: { receipt: { select: { id: true } } } },
      },
    });

    if (!tentativa) {
      throw new TentativaObservadaNaoEncontradaError();
    }

    return {
      paymentAttemptId: tentativa.id,
      status: tentativa.status,
      invoiceStatus: tentativa.invoice.status,
      paidAt: tentativa.invoice.paidAt,
      receiptId: tentativa.payment?.receipt?.id ?? null,
    };
  }
}
