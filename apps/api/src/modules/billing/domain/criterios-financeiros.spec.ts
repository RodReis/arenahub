import { describe, expect, it } from '@jest/globals';

import {
  ALUNO_COBRAVEL,
  FATURA_PAGA,
  faturaPagaNoMes,
  faturaVencidaEmAberto,
} from './criterios-financeiros.js';

describe('critérios financeiros do aluno', () => {
  it('inadimplente = invoice OPEN ou OVERDUE com vencimento ANTERIOR a agora', () => {
    const agora = new Date('2026-10-10T15:00:00.000Z');

    expect(faturaVencidaEmAberto(agora)).toEqual({
      status: { in: ['OPEN', 'OVERDUE'] },
      dueAt: { lt: agora },
    });
  });

  it('aluno cobrável = situação Ativo e perfil Aluno (o mesmo filtro do Relatório de Alunos)', () => {
    expect(ALUNO_COBRAVEL).toEqual({ status: 'ACTIVE', profile: 'STUDENT' });
  });

  it('pagante = invoice PAID com paidAt preenchido', () => {
    expect(FATURA_PAGA).toEqual({ status: 'PAID', paidAt: { not: null } });
  });

  describe('faturaPagaNoMes', () => {
    const SAO_PAULO = { id: 'u-sp', timezone: 'America/Sao_Paulo' };
    const MANAUS = { id: 'u-mn', timezone: 'America/Manaus' };

    it('um intervalo por unidade, no mês local da unidade (UTC-3 e UTC-4)', () => {
      // 31/08/2026 12:00 em São Paulo.
      const agora = new Date('2026-08-31T15:00:00.000Z');

      expect(faturaPagaNoMes(agora, [SAO_PAULO, MANAUS])).toEqual({
        ...FATURA_PAGA,
        OR: [
          {
            student: { gymUnitId: 'u-sp' },
            paidAt: {
              gte: new Date('2026-08-01T03:00:00.000Z'),
              lt: new Date('2026-09-01T03:00:00.000Z'),
            },
          },
          {
            student: { gymUnitId: 'u-mn' },
            paidAt: {
              gte: new Date('2026-08-01T04:00:00.000Z'),
              lt: new Date('2026-09-01T04:00:00.000Z'),
            },
          },
        ],
      });
    });

    it('o mês local pode ser outro que o de UTC: 01/09 01:00Z ainda é agosto em São Paulo', () => {
      const agora = new Date('2026-09-01T01:00:00.000Z');

      expect(faturaPagaNoMes(agora, [SAO_PAULO])).toMatchObject({
        OR: [
          {
            paidAt: {
              gte: new Date('2026-08-01T03:00:00.000Z'),
              lt: new Date('2026-09-01T03:00:00.000Z'),
            },
          },
        ],
      });
    });

    it('dezembro fecha em janeiro do ano seguinte', () => {
      const agora = new Date('2026-12-15T15:00:00.000Z');

      expect(faturaPagaNoMes(agora, [SAO_PAULO])).toMatchObject({
        OR: [
          {
            paidAt: {
              gte: new Date('2026-12-01T03:00:00.000Z'),
              lt: new Date('2027-01-01T03:00:00.000Z'),
            },
          },
        ],
      });
    });
  });
});
