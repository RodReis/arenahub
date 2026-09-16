import { describe, expect, it } from '@jest/globals';

import { FakePortaDeDeteccaoDeMeta } from './health-goal-detection.repository.fake.js';
import { HealthGoalDetectionSchedulerService } from './health-goal-detection-scheduler.service.js';

const AGORA = new Date('2026-09-16T12:00:00Z');

describe('HealthGoalDetectionSchedulerService', () => {
  it('marca ATINGIDA e publica quando o ultimo valor alcança o alvo', async () => {
    const porta = new FakePortaDeDeteccaoDeMeta();
    porta.comMeta({
      id: 'goal-1',
      tenantId: 't1',
      studentId: 'student-1',
      type: 'WEIGHT',
      baseline: 90,
      alvo: 80,
      prazo: new Date('2026-12-01T00:00:00Z'),
      achievedAt: null,
    });
    porta.comValorPublicado('t1', 'student-1', 'WEIGHT', 80);

    const job = new HealthGoalDetectionSchedulerService(porta);
    const resultado = await job.executarCiclo(AGORA);

    expect(resultado).toEqual({ conquistas: 1, falhas: 0 });
    expect(porta.conquistasGravadas).toEqual([{ tenantId: 't1', goalId: 'goal-1' }]);
  });

  it('nao marca quando o progresso ainda nao chegou no alvo', async () => {
    const porta = new FakePortaDeDeteccaoDeMeta();
    porta.comMeta({
      id: 'goal-1',
      tenantId: 't1',
      studentId: 'student-1',
      type: 'WEIGHT',
      baseline: 90,
      alvo: 80,
      prazo: new Date('2026-12-01T00:00:00Z'),
      achievedAt: null,
    });
    porta.comValorPublicado('t1', 'student-1', 'WEIGHT', 85);

    const job = new HealthGoalDetectionSchedulerService(porta);
    const resultado = await job.executarCiclo(AGORA);

    expect(resultado).toEqual({ conquistas: 0, falhas: 0 });
    expect(porta.conquistasGravadas).toEqual([]);
  });

  it('nao marca quando nao ha medicao publicada', async () => {
    const porta = new FakePortaDeDeteccaoDeMeta();
    porta.comMeta({
      id: 'goal-1',
      tenantId: 't1',
      studentId: 'student-1',
      type: 'WEIGHT',
      baseline: 90,
      alvo: 80,
      prazo: new Date('2026-12-01T00:00:00Z'),
      achievedAt: null,
    });

    const job = new HealthGoalDetectionSchedulerService(porta);
    const resultado = await job.executarCiclo(AGORA);

    expect(resultado).toEqual({ conquistas: 0, falhas: 0 });
  });
});
