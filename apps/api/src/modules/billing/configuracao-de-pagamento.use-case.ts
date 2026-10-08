import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import {
  CONFIGURACAO_DE_PAGAMENTO_PADRAO,
  validarConfiguracaoDePagamento,
  type ConfiguracaoDePagamento,
} from './domain/configuracao-de-pagamento.js';

const CAMPOS = { invoiceGenerationDay: true, dueDay: true, graceDays: true } as const;

/**
 * Configuracao de pagamento do tenant (F89, decisao do PI em 07/10/2026): dia
 * de gerar a parcela, dia do vencimento e dias de bloqueio depois dele.
 *
 * SO PARCELAS FUTURAS: salvar nunca toca em `Invoice`. `dueAt` e `blockAt` sao
 * gravados na abertura e ficam congelados -- o aluno ja viu aquela data.
 */
@Injectable()
export class ConfiguracaoDePagamentoUseCase {
  constructor(private readonly db: PrismaService) {}

  /** Sem linha, devolve o padrao SEM criar: ler nao grava. */
  async obter(tenantId: string): Promise<ConfiguracaoDePagamento> {
    const linha = await this.db.billingSettings.findUnique({ where: { tenantId }, select: CAMPOS });

    return linha ?? CONFIGURACAO_DE_PAGAMENTO_PADRAO;
  }

  /** Linha e auditoria na mesma transacao: ou as duas mudam, ou nenhuma. */
  async salvar(
    contexto: TenantContext,
    entrada: ConfiguracaoDePagamento,
    correlationId: string,
  ): Promise<ConfiguracaoDePagamento> {
    const nova = validarConfiguracaoDePagamento({
      invoiceGenerationDay: entrada.invoiceGenerationDay,
      dueDay: entrada.dueDay,
      graceDays: entrada.graceDays,
    });

    return this.db.$transaction(async (tx) => {
      const antes = await tx.billingSettings.findUnique({
        where: { tenantId: contexto.tenantId },
        select: CAMPOS,
      });

      await tx.billingSettings.upsert({
        where: { tenantId: contexto.tenantId },
        create: { tenantId: contexto.tenantId, ...nova },
        update: nova,
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'billing.settings_updated',
          target: 'BillingSettings',
          targetId: contexto.tenantId,
          correlationId,
          // Espalhado: o tipo do Json do Prisma pede assinatura de indice.
          metadata: { before: { ...(antes ?? CONFIGURACAO_DE_PAGAMENTO_PADRAO) }, after: { ...nova } },
        },
      });

      return nova;
    });
  }
}
