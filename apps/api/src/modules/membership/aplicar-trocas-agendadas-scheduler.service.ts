import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { comContexto } from '@arenahub/database';
import { randomUUID } from 'node:crypto';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { BillingRepository } from '../billing/billing.repository.js';
import { MembershipRepository } from './membership.repository.js';

export interface ResultadoDoCiclo {
  readonly aplicadas: number;
  readonly falhas: number;
}

/**
 * Aplica, no dia 1, a troca de plano que a recepcao agendou para o proximo
 * ciclo (#337, decisao do PI de 04/10/2026).
 *
 * NADA DE REGRA NOVA AQUI: aplicar e chamar `trocarPlanoDaAssinatura` (F82) --
 * a mesma troca atomica, com o mesmo cancelamento da invoice da competencia
 * corrente e o mesmo evento de timeline. Este job so decide QUANDO.
 *
 * REEXECUTAVEL: a troca cancela a assinatura antiga, entao ela sai da
 * consulta (`status ACTIVE`) e rodar duas vezes tem o efeito de rodar uma.
 *
 * ESPELHA `ExpirarAssinaturasSchedulerService`: `@Cron` ja ligado em
 * `app.module.ts`, trava de reentrada NO PROCESSO, `agora` injetado, falha de
 * UMA assinatura nao derruba as outras -- e fica no log, nao silenciosa.
 */
@Injectable()
export class AplicarTrocasAgendadasSchedulerService {
  private readonly log = new Logger(AplicarTrocasAgendadasSchedulerService.name);

  private executando = false;

  constructor(
    private readonly membership: MembershipRepository,
    private readonly billing: BillingRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'aplicar-trocas-de-plano-agendadas' })
  async executarComTrava(): Promise<void> {
    if (this.executando) {
      this.log.warn('ciclo anterior ainda em curso; pulando este ciclo');

      return;
    }

    this.executando = true;

    try {
      await this.executarCiclo(new Date());
    } finally {
      this.executando = false;
    }
  }

  async executarCiclo(agora: Date): Promise<ResultadoDoCiclo> {
    const vencidas = await this.membership.listarTrocasAgendadasVencidas(agora);

    let aplicadas = 0;
    let falhas = 0;

    for (const troca of vencidas) {
      // O "usuario" do job e quem agendou a troca (gravado em `lastActorId`).
      const contexto: TenantContext = {
        tenantId: troca.tenantId,
        actorId: troca.lastActorId,
        sessionId: 'aplicar-trocas-agendadas-scheduler',
        permissions: new Set<string>(),
        allowedUnitIds: 'ALL',
      };

      try {
        // `students` tem RLS: sem o escopo do tenant a elegibilidade volta
        // vazia e TODA troca falharia como "aluno nao encontrado". Job nao
        // passa pelo interceptor que abre esse escopo nas rotas.
        const resultado = await comContexto({ kind: 'tenant', tenantId: troca.tenantId }, () =>
          this.membership.trocarPlanoDaAssinatura(
            contexto,
            troca.id,
            { planId: troca.scheduledPlanId, versaoEsperada: troca.version, reason: troca.lastReason },
            randomUUID(),
            agora,
            // Mesma regra da troca no ato: parcela aberta cancelada volta no plano novo.
            (tx, subscriptionId, competencia) =>
              this.billing.abrirInvoiceDoPeriodo(contexto, { subscriptionId, emQue: competencia }, tx),
          ),
        );

        if (resultado) aplicadas += 1;
      } catch (erro: unknown) {
        falhas += 1;

        // A troca fica agendada e o job tenta de novo no proximo dia -- o erro
        // (plano desativado, aluno inelegivel) e o que a recepcao precisa
        // corrigir. Sem o objeto de erro cru: pode carregar dado de aluno.
        this.log.error(
          `falha ao aplicar troca agendada da assinatura ${troca.id} (tenant ${troca.tenantId}): ${
            erro instanceof Error ? erro.message : 'erro desconhecido'
          }`,
        );
      }
    }

    return { aplicadas, falhas };
  }
}
