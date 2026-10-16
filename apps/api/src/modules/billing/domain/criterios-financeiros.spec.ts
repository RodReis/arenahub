import { describe, expect, it } from '@jest/globals';

import { ALUNO_COBRAVEL, FATURA_PAGA, faturaVencidaEmAberto } from './criterios-financeiros.js';

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
});
