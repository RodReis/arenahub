import type { AcaoDeAviso } from '../../student-mobile/domain/aviso-do-aluno.js';

export type TipoDeAviso = 'BILLING' | 'ASSESSMENT' | 'MEMBERSHIP' | 'GENERAL';

export interface EventoDeOutbox {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

export interface AvisoAGravar {
  readonly kind: TipoDeAviso;
  readonly title: string;
  readonly body: string;
  readonly action: AcaoDeAviso;
  readonly actionTargetId: string | null;
  readonly expiresAt: Date | null;
}

const UM_DIA_MS = 24 * 60 * 60 * 1000;
const TRINTA_DIAS_MS = 30 * UM_DIA_MS;

/** `payload.dueDate`/`expiresOn` + 1 dia -- ver §3.1 da spec da F73. */
function umDiaApos(dataIso: unknown): Date | null {
  if (typeof dataIso !== 'string') return null;

  const data = new Date(dataIso);
  if (Number.isNaN(data.getTime())) return null;

  return new Date(data.getTime() + UM_DIA_MS);
}

export function avisoParaEvento(evento: EventoDeOutbox, agora: Date): AvisoAGravar | null {
  switch (evento.eventType) {
    case 'InvoicePaid':
      return {
        kind: 'BILLING',
        title: 'Pagamento confirmado',
        body: 'Recebemos o pagamento da sua fatura.',
        action: 'OPEN_INVOICE',
        actionTargetId: evento.aggregateId,
        expiresAt: null,
      };

    case 'InvoiceDueSoon':
      return {
        kind: 'BILLING',
        title: 'Fatura vencendo em breve',
        body: 'Sua fatura vence em poucos dias.',
        action: 'OPEN_INVOICE',
        actionTargetId: evento.aggregateId,
        expiresAt: umDiaApos(evento.payload['dueDate']),
      };

    case 'InvoiceOverdue':
      return {
        kind: 'BILLING',
        title: 'Fatura vencida',
        body: 'Sua fatura está vencida.',
        action: 'OPEN_INVOICE',
        actionTargetId: evento.aggregateId,
        expiresAt: null,
      };

    case 'MembershipExpiringSoon':
      return {
        kind: 'MEMBERSHIP',
        title: 'Plano vencendo em breve',
        body: 'Seu plano está prestes a vencer.',
        action: 'NONE',
        actionTargetId: null,
        expiresAt: umDiaApos(evento.payload['expiresOn']),
      };

    case 'HealthGoalReached':
      return {
        kind: 'GENERAL',
        title: 'Meta atingida',
        body: 'Você atingiu uma meta de saúde.',
        action: 'OPEN_HEALTH',
        actionTargetId: evento.aggregateId,
        expiresAt: null,
      };

    case 'AssessmentPublished':
      return {
        kind: 'ASSESSMENT',
        title: 'Nova avaliação disponível',
        body: 'Sua avaliação física foi publicada.',
        action: 'OPEN_HEALTH',
        actionTargetId: evento.aggregateId,
        expiresAt: null,
      };

    case 'RankingUpdated':
      return {
        kind: 'GENERAL',
        title: 'Ranking atualizado',
        body: 'O ranking do mês foi atualizado.',
        action: 'NONE',
        actionTargetId: null,
        expiresAt: new Date(agora.getTime() + TRINTA_DIAS_MS),
      };

    case 'StudentAbsent':
      return {
        kind: 'GENERAL',
        title: 'Sentimos sua falta',
        body: 'Faz um tempo que você não aparece na academia.',
        action: 'OPEN_ATTENDANCE',
        actionTargetId: null,
        expiresAt: null,
      };

    default:
      return null;
  }
}
