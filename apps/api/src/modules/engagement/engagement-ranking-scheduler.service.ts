import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { mesAnterior, mesLocal } from './domain/movimento-de-xp.js';
import { EngagementRankingService } from './engagement-ranking.service.js';
import { PORTA_DE_RANKING, type PortaDeRanking } from './engagement-ranking.repository.js';

/** Sem usuario de painel agindo -- quem "age" e o proprio job. Mesmo padrao
 * de `KioskConfigService.SEM_USUARIO`: `audit_logs.actor_id` e anulavel
 * exatamente para isto. */
const SEM_USUARIO = null as unknown as string;

/**
 * Fechamento mensal do placar -- Emenda de 27/08/2026 (ADR-047).
 *
 * O hero publico le o mes CORRENTE ao vivo (`EngagementRankingService.
 * placarAoVivo`); este job cuida do outro lado: o mes que ACABOU de fechar
 * vira snapshot PUBLICADO, o registro imutavel que `M5-FR-010` pede. O
 * painel continua podendo gerar/publicar manualmente a qualquer momento --
 * este job so cobre o caso automatico.
 *
 * ESPELHA `AlertSchedulerService` (F11) de proposito -- mesmo precedente,
 * mesmas quatro garantias:
 *   - `@Cron` do `@nestjs/schedule`, ja ligado em `app.module.ts`;
 *   - trava de reentrada NO PROCESSO (nao substitui idempotencia do banco,
 *     protege de uma execucao lenta receber a proxima por cima);
 *   - `agora` INJETADO -- o teste nao espera um mes;
 *   - falha de um tenant/unidade NAO derruba os outros -- vira log e o
 *     laco segue.
 *
 * DIARIO, nao mensal: um `@Cron` que roda toda meia-noite e so verifica "ja
 * publiquei o mes anterior desta unidade?" e mais simples de raciocinar (sem
 * calcular "e dia 1?") e converge identico -- nos outros 29 dias do mes o
 * `snapshotPublicado` ja existe e o job nao faz nada.
 */
@Injectable()
export class EngagementRankingSchedulerService {
  private readonly log = new Logger(EngagementRankingSchedulerService.name);

  /** Trava de reentrada -- ver `AlertSchedulerService.avaliando`. */
  private fechando = false;

  constructor(
    private readonly ranking: EngagementRankingService,
    @Inject(PORTA_DE_RANKING) private readonly porta: PortaDeRanking,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'fechamento-mensal-de-ranking' })
  async fechar(): Promise<void> {
    if (this.fechando) {
      this.log.warn('fechamento anterior ainda em curso; pulando este ciclo');

      return;
    }

    this.fechando = true;

    try {
      await this.executarCiclo(new Date());
    } finally {
      this.fechando = false;
    }
  }

  /**
   * Um ciclo completo. `agora` injetado -- o teste nao espera um mes.
   *
   * Idempotente por CONSTRUCAO: se o mes anterior ja tem snapshot
   * PUBLICADO, nem tenta gerar de novo. Rodar duas vezes no mesmo dia (ou o
   * job travar e reprocessar) produz o mesmo resultado.
   *
   * Falha em uma unidade NAO impede as outras -- um tenant com dado
   * inconsistente nao pode impedir o fechamento de todo o resto.
   */
  async executarCiclo(agora: Date): Promise<{ unidades: number; fechadas: number; falhas: number }> {
    const unidades = await this.porta.unidadesAtivasComTimezone();

    let fechadas = 0;
    let falhas = 0;

    for (const unidade of unidades) {
      try {
        const fechou = await this.fecharUnidade(unidade, agora);
        if (fechou) fechadas += 1;
      } catch (erro: unknown) {
        falhas += 1;

        // Sem o objeto de erro cru: pode carregar trecho de query com dado
        // de aluno. tenant/unidade bastam para investigar.
        this.log.error(
          `falha ao fechar ranking do tenant ${unidade.tenantId}, unidade ${unidade.gymUnitId}: ${
            erro instanceof Error ? erro.message : 'erro desconhecido'
          }`,
        );
      }
    }

    return { unidades: unidades.length, fechadas, falhas };
  }

  /** Fecha UMA unidade -- `true` se publicou um snapshot novo, `false` se
   * ja existia (idempotencia) ou a coorte ficou WITHHELD. Um WITHHELD NAO e
   * falha -- e a politica funcionando -- entao nunca vira log de erro. */
  private async fecharUnidade(
    unidade: { tenantId: string; gymUnitId: string; timezone: string },
    agora: Date,
  ): Promise<boolean> {
    const mesFechado = mesAnterior(mesLocal(agora, unidade.timezone));

    const contexto: TenantContext = {
      tenantId: unidade.tenantId,
      actorId: SEM_USUARIO,
      sessionId: 'engagement-ranking-scheduler',
      permissions: new Set<string>(),
      allowedUnitIds: new Set([unidade.gymUnitId]),
    };

    const jaPublicado = await this.porta.snapshotPublicado(contexto, unidade.gymUnitId, mesFechado);
    if (jaPublicado) return false;

    const snapshot = await this.ranking.gerarSnapshot(contexto, unidade.gymUnitId, mesFechado, agora);

    if (snapshot.status === 'WITHHELD') return false;

    await this.ranking.publicar(contexto, snapshot.id, agora);

    return true;
  }
}
