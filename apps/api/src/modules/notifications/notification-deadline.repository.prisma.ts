import { Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';
import type {
  AlunoParaAvaliar,
  InvoiceParaAvaliar,
  PortaDePrazo,
  SubscriptionParaAvaliar,
} from './notification-deadline.repository.js';

/** Janela de vencimento avaliada -- D-3 a D+3, a mesma folga do gatilho
 * puro (`estaNoLimiarDeVencimento`), que decide o dia exato. */
const JANELA_DE_VENCIMENTO_EM_DIAS = 4;
/** Nao reemite StudentAbsent enquanto a ausencia persistir dentro desta
 * janela (decisao do PI: 7 dias de limiar, ver domain/gatilhos-de-prazo). */
const JANELA_DE_SUPRESSAO_DE_AUSENCIA_EM_DIAS = 7;

/**
 * `invoices`/`subscriptions`/`students`/`outbox_events` NAO tem politica
 * RLS que afete este job (so `Student` tem, e a leitura aqui e agregada,
 * cross-tenant, sem contexto de requisicao) -- `this.db` direto.
 */
@Injectable()
export class NotificationDeadlineRepository implements PortaDePrazo {
  constructor(private readonly db: PrismaService) {}

  async invoicesAbertasSemAvisoDeVencimento(agora: Date): Promise<readonly InvoiceParaAvaliar[]> {
    const de = new Date(agora.getTime());
    const ate = new Date(agora.getTime() + JANELA_DE_VENCIMENTO_EM_DIAS * 24 * 60 * 60 * 1000);

    const invoices = await this.db.invoice.findMany({
      where: { status: 'OPEN', dueAt: { gte: de, lte: ate } },
      select: { id: true, tenantId: true, dueAt: true },
    });

    // Idempotencia: sem InvoiceDueSoon emitido para esta invoice ainda. Nao
    // ha coluna nova -- a pergunta e sobre o outbox, a fonte unica.
    const jaAvisadas = await this.db.outboxEvent.findMany({
      where: { eventType: 'InvoiceDueSoon', aggregateType: 'Invoice', aggregateId: { in: invoices.map((i) => i.id) } },
      select: { aggregateId: true },
    });
    const avisadas = new Set(jaAvisadas.map((e) => e.aggregateId));

    return invoices.filter((invoice) => !avisadas.has(invoice.id));
  }

  async assinaturasAtivasSemAvisoDeVencimento(agora: Date): Promise<readonly SubscriptionParaAvaliar[]> {
    const de = new Date(agora.getTime());
    const ate = new Date(agora.getTime() + JANELA_DE_VENCIMENTO_EM_DIAS * 24 * 60 * 60 * 1000);

    const assinaturas = await this.db.subscription.findMany({
      where: { status: 'ACTIVE', endsAt: { gte: de, lte: ate } },
      select: { id: true, tenantId: true, endsAt: true },
    });

    const comEndsAt = assinaturas.filter(
      (assinatura): assinatura is typeof assinatura & { endsAt: Date } => assinatura.endsAt !== null,
    );

    const jaAvisadas = await this.db.outboxEvent.findMany({
      where: {
        eventType: 'MembershipExpiringSoon',
        aggregateType: 'Subscription',
        aggregateId: { in: comEndsAt.map((s) => s.id) },
      },
      select: { aggregateId: true },
    });
    const avisadas = new Set(jaAvisadas.map((e) => e.aggregateId));

    return comEndsAt.filter((assinatura) => !avisadas.has(assinatura.id));
  }

  async alunosSemAvisoDeAusencia(agora: Date): Promise<readonly AlunoParaAvaliar[]> {
    const limiar = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const supressaoDesde = new Date(
      agora.getTime() - JANELA_DE_SUPRESSAO_DE_AUSENCIA_EM_DIAS * 24 * 60 * 60 * 1000,
    );

    // Ultima sessao de cada aluno ATIVO, dentro de uma janela razoavel
    // (30 dias) -- alem disso a ausencia ja e obvia havia muito, e a lista
    // completa de "todo aluno ativo" cross-tenant seria cara sem filtro.
    const sessoes = await this.db.studentAttendanceSession.groupBy({
      by: ['studentId', 'tenantId'],
      _max: { lastPassageAt: true },
      where: { student: { status: 'ACTIVE' } },
    });

    const candidatos = sessoes
      .filter((sessao) => sessao._max.lastPassageAt !== null && sessao._max.lastPassageAt <= limiar)
      .map((sessao) => ({
        studentId: sessao.studentId,
        tenantId: sessao.tenantId,
        ultimoCheckIn: sessao._max.lastPassageAt as Date,
      }));

    if (candidatos.length === 0) return [];

    const jaAvisados = await this.db.outboxEvent.findMany({
      where: {
        eventType: 'StudentAbsent',
        aggregateType: 'Student',
        aggregateId: { in: candidatos.map((c) => c.studentId) },
        occurredAt: { gte: supressaoDesde },
      },
      select: { aggregateId: true },
    });
    const avisadosRecentemente = new Set(jaAvisados.map((e) => e.aggregateId));

    return candidatos.filter((candidato) => !avisadosRecentemente.has(candidato.studentId));
  }

  async publicarEvento(
    tenantId: string,
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.db.outboxEvent.create({
      data: { tenantId, eventType, aggregateType, aggregateId, payload: payload as Prisma.InputJsonValue },
    });
  }
}
