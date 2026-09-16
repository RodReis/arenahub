import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { estaAusenteHaSeteDias, estaNoLimiarDeVencimento } from './domain/gatilhos-de-prazo.js';
import { PORTA_DE_PRAZO, type PortaDePrazo } from './notification-deadline.repository.js';

/** D-3, mesma janela para invoice e assinatura -- spec da F73 §4.2. */
const DIAS_DE_ANTECEDENCIA = 3;

export interface ResultadoDoCiclo {
  avisosDeVencimentoDeInvoice: number;
  avisosDeVencimentoDeAssinatura: number;
  avisosDeAusencia: number;
  falhas: number;
}

/**
 * Job diario dos eventos de notificação que nascem de PRAZO, não de
 * mutação -- F73 §4.2.
 *
 * ESPELHA `PlatformInvoiceSchedulerService`/`EngagementRankingSchedulerService`
 * de propósito: `@Cron` diário, trava de reentrada, `agora` injetado, falha
 * de um item não impede os demais.
 *
 * A idempotência ("não repete o aviso todo dia") mora na QUERY da porta —
 * `invoicesAbertasSemAvisoDeVencimento` já filtra fora quem tem
 * `OutboxEvent` deste tipo emitido no período relevante, não numa coluna
 * nova nem num `if` neste service.
 */
@Injectable()
export class NotificationDeadlineSchedulerService {
  private readonly log = new Logger(NotificationDeadlineSchedulerService.name);

  /** Trava de reentrada -- ver `EngagementRankingSchedulerService.fechando`. */
  private avaliando = false;

  constructor(@Inject(PORTA_DE_PRAZO) private readonly porta: PortaDePrazo) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'prazos-de-notificacao' })
  async avaliar(): Promise<void> {
    if (this.avaliando) {
      this.log.warn('avaliação anterior ainda em curso; pulando este ciclo');

      return;
    }

    this.avaliando = true;

    try {
      await this.executarCiclo(new Date());
    } finally {
      this.avaliando = false;
    }
  }

  /** Um ciclo completo. `agora` injetado -- o teste não espera a meia-noite. */
  async executarCiclo(agora: Date): Promise<ResultadoDoCiclo> {
    const resultado: ResultadoDoCiclo = {
      avisosDeVencimentoDeInvoice: 0,
      avisosDeVencimentoDeAssinatura: 0,
      avisosDeAusencia: 0,
      falhas: 0,
    };

    const [invoices, assinaturas, alunos] = await Promise.all([
      this.porta.invoicesAbertasSemAvisoDeVencimento(agora),
      this.porta.assinaturasAtivasSemAvisoDeVencimento(agora),
      this.porta.alunosSemAvisoDeAusencia(agora),
    ]);

    for (const invoice of invoices) {
      if (!estaNoLimiarDeVencimento(invoice.dueAt, agora, DIAS_DE_ANTECEDENCIA)) continue;

      const publicou = await this.tentarPublicar(
        invoice.tenantId,
        'InvoiceDueSoon',
        'Invoice',
        invoice.id,
        { dueDate: invoice.dueAt.toISOString() },
      );
      if (publicou) resultado.avisosDeVencimentoDeInvoice += 1;
      else resultado.falhas += 1;
    }

    for (const assinatura of assinaturas) {
      if (!estaNoLimiarDeVencimento(assinatura.endsAt, agora, DIAS_DE_ANTECEDENCIA)) continue;

      const publicou = await this.tentarPublicar(
        assinatura.tenantId,
        'MembershipExpiringSoon',
        'Subscription',
        assinatura.id,
        { expiresOn: assinatura.endsAt.toISOString() },
      );
      if (publicou) resultado.avisosDeVencimentoDeAssinatura += 1;
      else resultado.falhas += 1;
    }

    for (const aluno of alunos) {
      if (!estaAusenteHaSeteDias(aluno.ultimoCheckIn, agora)) continue;

      const publicou = await this.tentarPublicar(
        aluno.tenantId,
        'StudentAbsent',
        'Student',
        aluno.studentId,
        {},
      );
      if (publicou) resultado.avisosDeAusencia += 1;
      else resultado.falhas += 1;
    }

    return resultado;
  }

  /** `false` em falha -- vira log, nunca derruba o ciclo inteiro. */
  private async tentarPublicar(
    tenantId: string,
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await this.porta.publicarEvento(tenantId, eventType, aggregateType, aggregateId, payload);

      return true;
    } catch (erro: unknown) {
      this.log.error(
        `falha ao publicar ${eventType} para ${aggregateType}/${aggregateId}: ` +
          `${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
      );

      return false;
    }
  }
}
