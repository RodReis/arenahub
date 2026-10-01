import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import { AssinaturaNaoEncontradaError, ConfiguracaoFinanceiraAusenteError } from './billing.repository.js';
import { mesesPagaveis, type MesPagavel } from './domain/meses-pagaveis.js';
import { invoicesDaFaixa } from './invoices-da-faixa.js';

/**
 * Leitura pura da faixa de meses pagaveis (F83, issue #458). Nao grava
 * nada -- a invoice do mes NOT_OPENED so existe de verdade quando o lote e
 * de fato pago (RegistrarPagamentoEmLoteUseCase).
 */
@Injectable()
export class ConsultarMesesPagaveisUseCase {
  constructor(private readonly db: PrismaService) {}

  async executar(contexto: TenantContext, subscriptionId: string, agora: Date): Promise<MesPagavel[]> {
    const assinatura = await this.db.subscription.findFirst({
      where: { id: subscriptionId, tenantId: contexto.tenantId },
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

    const invoices = await invoicesDaFaixa(this.db, contexto.tenantId, assinatura);

    return mesesPagaveis({
      invoices,
      agora,
      endsAt: assinatura.endsAt,
      prices: assinatura.plan.prices,
      dueDay: configuracao.dueDay,
    });
  }
}
