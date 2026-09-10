import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { avaliarCarencia } from './domain/carencia.js';
import { PlatformAuditService } from './platform-audit.service.js';

/**
 * Fecha a catraca do tenant inadimplente -- F65, ADR-053.
 *
 * ESPELHA `PlatformInvoiceUseCase` de proposito (`registrarAto`): mesmo
 * padrao de auditoria de job, sem usuario de painel por tras.
 *
 * O `where` do update inclui `status: 'ACTIVE'` -- e o que da idempotencia:
 * rodar duas vezes nao re-suspende quem ja esta `SUSPENDED`, e nunca toca
 * quem esta `INACTIVE` (desligado pelo dono do SaaS por outro motivo).
 */
@Injectable()
export class SuspenderTenantUseCase {
  private readonly log = new Logger(SuspenderTenantUseCase.name);

  constructor(
    private readonly db: PrismaService,
    private readonly auditoria: PlatformAuditService,
  ) {}

  /**
   * Suspende os tenants ACTIVE, com `autoSuspend` ligado, que passaram da
   * carencia. `agora` injetado -- o teste nao espera dias.
   */
  async executarCiclo(
    agora: Date,
  ): Promise<{ avaliados: number; suspensos: number; falhas: number }> {
    const candidatos = await this.db.tenant.findMany({
      where: {
        status: 'ACTIVE',
        autoSuspend: true,
        platformInvoices: { some: { status: 'OVERDUE' } },
      },
      include: { gymUnits: { take: 1, orderBy: { createdAt: 'asc' } } },
    });

    let suspensos = 0;
    let falhas = 0;

    for (const tenant of candidatos) {
      try {
        const contrato = await this.db.tenantContract.findFirst({
          where: { tenantId: tenant.id, status: 'ACTIVE' },
        });

        // Sem contrato vigente nao ha `graceDays` para avaliar -- pula, nao
        // e falha do job.
        if (!contrato) continue;

        const faturasVencidas = await this.db.platformInvoice.findMany({
          where: { tenantId: tenant.id, status: 'OVERDUE' },
          select: { dueAt: true, totalMinor: true },
        });

        const timezone = tenant.timezone ?? tenant.gymUnits[0]?.timezone;

        // Sem timezone (tenant nem unidade tem um cadastrado) nao ha como
        // avaliar as 6h locais -- pula, nao e falha do job.
        if (!timezone) continue;

        const situacao = avaliarCarencia({
          faturasVencidas,
          graceDays: contrato.graceDays,
          agora,
          timezone,
        });

        if (!situacao.deveSuspender) continue;

        const suspendeu = await this.db.$transaction(async (tx) => {
          const alterados = await tx.tenant.updateMany({
            where: { id: tenant.id, status: 'ACTIVE' },
            data: { status: 'SUSPENDED' },
          });

          if (alterados.count === 0) return false;

          await this.registrarAto(
            tx,
            null,
            {
              action: 'tenant.suspended_automatically',
              target: 'tenant',
              targetId: tenant.id,
              tenantId: tenant.id,
              metadata: {
                emAbertoMinor: situacao.emAbertoMinor,
                vencidaEm: situacao.vencidaEm?.toISOString() ?? null,
              },
            },
            CORRELACAO_DO_JOB,
          );

          return true;
        });

        if (suspendeu) suspensos += 1;
      } catch (erro: unknown) {
        falhas += 1;

        this.log.error(
          `falha ao avaliar suspensão do tenant ${tenant.id}: ` +
            `${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
        );
      }
    }

    return { avaliados: candidatos.length, suspensos, falhas };
  }

  /**
   * Levanta o gate de um tenant suspenso AUTOMATICAMENTE.
   *
   * So volta a `ACTIVE` se a auditoria de mudanca de status mais recente do
   * tenant -- entre `tenant.suspended_automatically`, `tenant.status_changed`
   * e `tenant.gate_lifted` -- for a suspensao automatica. Nao basta achar A
   * linha automatica mais recente (`findFirst` filtrado so por essa acao):
   * se o PI suspendeu o MESMO tenant a mao depois (`tenant.status_changed`),
   * essa suspensao automatica antiga deixou de ser a causa do `SUSPENDED`
   * atual, e reabrir aqui passaria por cima da decisao do PI (spec SS5.6).
   */
  async levantarGate(
    tenantId: string,
    correlationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const cliente = tx ?? this.db;

    const ultimaMudancaDeStatus = await cliente.platformAuditLog.findFirst({
      where: {
        tenantId,
        action: {
          in: ['tenant.suspended_automatically', 'tenant.status_changed', 'tenant.gate_lifted'],
        },
      },
      orderBy: { occurredAt: 'desc' },
    });

    if (ultimaMudancaDeStatus?.action !== 'tenant.suspended_automatically') return false;

    const alterados = await cliente.tenant.updateMany({
      where: { id: tenantId, status: 'SUSPENDED' },
      data: { status: 'ACTIVE' },
    });

    if (alterados.count === 0) return false;

    await this.registrarAto(
      cliente,
      null,
      { action: 'tenant.gate_lifted', target: 'tenant', targetId: tenantId, tenantId },
      correlationId,
    );

    return true;
  }

  /** Auditoria dentro da transacao, sempre sem usuario de painel (e job). */
  private async registrarAto(
    tx: Prisma.TransactionClient,
    contexto: PlatformContext | null,
    ato: Parameters<PlatformAuditService['registrar']>[1],
    correlationId: string,
  ): Promise<void> {
    // `null` significa "sem usuario agindo -- quem age e o job".
    // `actor_user_id` e anulavel no schema exatamente para isto.
    await this.auditoria.registrar(contexto, ato, correlationId, tx);
  }
}

/** Correlacao das escritas do job -- nao ha requisicao HTTP por tras. */
const CORRELACAO_DO_JOB = 'platform-suspensao-scheduler';
