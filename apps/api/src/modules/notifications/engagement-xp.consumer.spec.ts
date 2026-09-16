import { describe, expect, it } from '@jest/globals';

import { FakePortaDeXp } from '../engagement/engagement-xp.repository.fake.js';
import { EngagementXpConsumer } from './engagement-xp.consumer.js';

const AGORA = new Date('2026-09-16T12:00:00Z');
const CONTEXTO_QUALQUER = {
  tenantId: 't1',
  actorId: null as unknown as string,
  sessionId: 's',
  permissions: new Set<string>(),
  allowedUnitIds: 'ALL' as const,
};

describe('EngagementXpConsumer', () => {
  it('trata AssessmentPublished e HealthGoalReached, mais nenhum outro', () => {
    const consumer = new EngagementXpConsumer(new FakePortaDeXp(), () => AGORA);

    expect(consumer.trata('AssessmentPublished')).toBe(true);
    expect(consumer.trata('HealthGoalReached')).toBe(true);
    expect(consumer.trata('InvoicePaid')).toBe(false);
  });

  it('credita 100 XP de meta atingida para o aluno do evento', async () => {
    const porta = new FakePortaDeXp();
    porta.comRegra({ points: 100, trigger: 'META_ATINGIDA' });
    porta.comAluno('student-1', 'America/Sao_Paulo');

    const consumer = new EngagementXpConsumer(porta, () => AGORA);

    await consumer.processar({
      id: 'e1',
      tenantId: 't1',
      eventType: 'HealthGoalReached',
      aggregateType: 'Student',
      aggregateId: 'student-1',
      payload: { goalId: 'goal-1' },
    });

    const movimentos = await porta.movimentosDoAluno(CONTEXTO_QUALQUER, 'student-1');
    expect(movimentos).toEqual([
      expect.objectContaining({ points: 100, sourceKind: 'HEALTH_GOAL', sourceId: 'goal-1' }),
    ]);
  });

  it('credita 20 XP de avaliacao publicada usando o studentId do payload', async () => {
    const porta = new FakePortaDeXp();
    porta.comRegra({ points: 20, trigger: 'AVALIACAO_PUBLICADA' });
    porta.comAluno('student-2', 'America/Sao_Paulo');

    const consumer = new EngagementXpConsumer(porta, () => AGORA);

    await consumer.processar({
      id: 'e2',
      tenantId: 't1',
      eventType: 'AssessmentPublished',
      aggregateType: 'Assessment',
      aggregateId: 'assessment-1',
      payload: { studentId: 'student-2' },
    });

    const movimentos = await porta.movimentosDoAluno(CONTEXTO_QUALQUER, 'student-2');
    expect(movimentos).toEqual([
      expect.objectContaining({ points: 20, sourceKind: 'ASSESSMENT', sourceId: 'assessment-1' }),
    ]);
  });

  it('nao credita quando o tenant nao tem regra vigente para o gatilho', async () => {
    const porta = new FakePortaDeXp();
    porta.comAluno('student-1', 'America/Sao_Paulo');

    const consumer = new EngagementXpConsumer(porta, () => AGORA);

    await consumer.processar({
      id: 'e1',
      tenantId: 't1',
      eventType: 'HealthGoalReached',
      aggregateType: 'Student',
      aggregateId: 'student-1',
      payload: {},
    });

    const movimentos = await porta.movimentosDoAluno(CONTEXTO_QUALQUER, 'student-1');
    expect(movimentos).toEqual([]);
  });
});
