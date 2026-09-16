import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { calcularProgresso } from '../health/domain/progresso-da-meta.js';
import {
  PORTA_DE_DETECCAO_DE_META,
  type PortaDeDeteccaoDeMeta,
} from './health-goal-detection.repository.js';

export interface ResultadoDaDeteccao {
  conquistas: number;
  falhas: number;
}

/**
 * Detecta meta de saude atingida e publica `HealthGoalReached` -- F73 §4.1.
 *
 * `achievedAt` era campo CALCULADO sob demanda (`attendance.service.ts`
 * comparava contra a ultima medicao a cada leitura, sem gravar nada). Este
 * job passa a gravar o instante e a publicar o evento, na mesma transacao
 * (regra de arquitetura 5) -- decisao do PI em 16/09/2026, ao ver que
 * `AssessmentPublished`/`HealthGoalReached` eram declarados consumidos pelo
 * MVP-05 §12 e nunca produzidos (issue #343).
 *
 * ESPELHA os outros schedulers da fatia: `@Cron` diario, trava de
 * reentrada, `agora` injetado, falha isolada por meta.
 */
@Injectable()
export class HealthGoalDetectionSchedulerService {
  private readonly log = new Logger(HealthGoalDetectionSchedulerService.name);

  /** Trava de reentrada -- ver `EngagementRankingSchedulerService.fechando`. */
  private detectando = false;

  constructor(
    @Inject(PORTA_DE_DETECCAO_DE_META) private readonly porta: PortaDeDeteccaoDeMeta,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'deteccao-de-meta-atingida' })
  async detectar(): Promise<void> {
    if (this.detectando) {
      this.log.warn('detecção anterior ainda em curso; pulando este ciclo');

      return;
    }

    this.detectando = true;

    try {
      await this.executarCiclo(new Date());
    } finally {
      this.detectando = false;
    }
  }

  /** Um ciclo completo. `agora` injetado -- o teste não espera a meia-noite. */
  async executarCiclo(agora: Date): Promise<ResultadoDaDeteccao> {
    const metas = await this.porta.metasAtivasSemConquista();

    let conquistas = 0;
    let falhas = 0;

    for (const meta of metas) {
      try {
        const atual = await this.porta.ultimoValorPublicado(meta.tenantId, meta.studentId, meta.type);
        if (atual === null) continue;

        const progresso = calcularProgresso(meta, atual, agora);
        if (progresso.estado !== 'ATINGIDA') continue;

        const marcou = await this.porta.marcarAtingidaEPublicar(meta.tenantId, meta.id, agora);
        if (marcou) conquistas += 1;
      } catch (erro: unknown) {
        falhas += 1;

        this.log.error(
          `falha ao avaliar meta ${meta.id} do aluno ${meta.studentId}: ` +
            `${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
        );
      }
    }

    return { conquistas, falhas };
  }
}
