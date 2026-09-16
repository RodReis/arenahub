import { describe, expect, it } from '@jest/globals';

import { FakePortaDePrazo } from './notification-deadline.repository.fake.js';
import { NotificationDeadlineSchedulerService } from './notification-deadline-scheduler.service.js';

const AGORA = new Date('2026-09-16T00:00:00Z');

describe('NotificationDeadlineSchedulerService', () => {
  it('publica InvoiceDueSoon para invoice vencendo em D+3', async () => {
    const porta = new FakePortaDePrazo();
    porta.comInvoice({ id: 'invoice-1', tenantId: 't1', dueAt: new Date('2026-09-19T00:00:00Z') });

    const job = new NotificationDeadlineSchedulerService(porta);
    const resultado = await job.executarCiclo(AGORA);

    expect(resultado.avisosDeVencimentoDeInvoice).toBe(1);
    expect(porta.eventosPublicados).toEqual([
      {
        tenantId: 't1',
        eventType: 'InvoiceDueSoon',
        aggregateType: 'Invoice',
        aggregateId: 'invoice-1',
        payload: { dueDate: '2026-09-19T00:00:00.000Z' },
      },
    ]);
  });

  it('nao publica para invoice fora do limiar de 3 dias', async () => {
    const porta = new FakePortaDePrazo();
    porta.comInvoice({ id: 'invoice-1', tenantId: 't1', dueAt: new Date('2026-09-25T00:00:00Z') });

    const job = new NotificationDeadlineSchedulerService(porta);
    const resultado = await job.executarCiclo(AGORA);

    expect(resultado.avisosDeVencimentoDeInvoice).toBe(0);
    expect(porta.eventosPublicados).toEqual([]);
  });

  it('publica MembershipExpiringSoon para assinatura vencendo em D+3', async () => {
    const porta = new FakePortaDePrazo();
    porta.comAssinatura({
      id: 'sub-1',
      tenantId: 't1',
      endsAt: new Date('2026-09-19T00:00:00Z'),
    });

    const job = new NotificationDeadlineSchedulerService(porta);
    const resultado = await job.executarCiclo(AGORA);

    expect(resultado.avisosDeVencimentoDeAssinatura).toBe(1);
    expect(porta.eventosPublicados).toEqual([
      {
        tenantId: 't1',
        eventType: 'MembershipExpiringSoon',
        aggregateType: 'Subscription',
        aggregateId: 'sub-1',
        payload: { expiresOn: '2026-09-19T00:00:00.000Z' },
      },
    ]);
  });

  it('publica StudentAbsent para aluno sem check-in ha 7 dias ou mais', async () => {
    const porta = new FakePortaDePrazo();
    porta.comAluno({
      studentId: 'student-1',
      tenantId: 't1',
      ultimoCheckIn: new Date('2026-09-09T00:00:00Z'),
    });

    const job = new NotificationDeadlineSchedulerService(porta);
    const resultado = await job.executarCiclo(AGORA);

    expect(resultado.avisosDeAusencia).toBe(1);
    expect(porta.eventosPublicados).toEqual([
      {
        tenantId: 't1',
        eventType: 'StudentAbsent',
        aggregateType: 'Student',
        aggregateId: 'student-1',
        payload: {},
      },
    ]);
  });

  it('nao publica StudentAbsent para aluno com check-in ha 6 dias', async () => {
    const porta = new FakePortaDePrazo();
    porta.comAluno({
      studentId: 'student-1',
      tenantId: 't1',
      ultimoCheckIn: new Date('2026-09-10T00:00:00Z'),
    });

    const job = new NotificationDeadlineSchedulerService(porta);
    const resultado = await job.executarCiclo(AGORA);

    expect(resultado.avisosDeAusencia).toBe(0);
  });

  it('falha em um item nao impede os demais', async () => {
    const porta = new FakePortaDePrazo();
    porta.comInvoice({ id: 'invoice-1', tenantId: 't1', dueAt: new Date('2026-09-19T00:00:00Z') });
    porta.comInvoice({ id: 'invoice-2', tenantId: 't1', dueAt: new Date('2026-09-19T00:00:00Z') });

    let chamadas = 0;
    const publicarOriginal = porta.publicarEvento.bind(porta);
    porta.publicarEvento = (...args) => {
      chamadas += 1;
      if (chamadas === 1) return Promise.reject(new Error('falha simulada'));
      return publicarOriginal(...args);
    };

    const job = new NotificationDeadlineSchedulerService(porta);
    const resultado = await job.executarCiclo(AGORA);

    expect(resultado.avisosDeVencimentoDeInvoice).toBe(1);
    expect(resultado.falhas).toBe(1);
  });
});
