import { describe, expect, it } from '@jest/globals';

import {
  MESES_DO_HISTORICO,
  recortarHistorico,
  type InvoiceDoHistorico,
} from './historico-de-pagamentos.js';

const AGORA = new Date('2026-08-26T12:00:00.000Z');

function invoice(
  over: Omit<Partial<InvoiceDoHistorico>, 'id' | 'dueAt'> & { id: string; dueAt: string },
): InvoiceDoHistorico {
  return {
    id: over.id,
    status: over.status ?? 'PAID',
    dueAt: new Date(over.dueAt),
    paidAt: over.paidAt ?? null,
    totalMinor: over.totalMinor ?? 18_990,
    currency: over.currency ?? 'BRL',
  };
}

describe('recortarHistorico', () => {
  it('devolve lista vazia quando o aluno não tem fatura', () => {
    expect(recortarHistorico([], AGORA, MESES_DO_HISTORICO)).toEqual([]);
  });

  it('põe a fatura em aberto no topo, antes das pagas mais recentes', () => {
    const linhas = recortarHistorico(
      [
        invoice({ id: 'paga-julho', dueAt: '2026-07-10T00:00:00.000Z', paidAt: new Date('2026-07-09T00:00:00.000Z') }),
        invoice({ id: 'aberta', dueAt: '2026-08-10T00:00:00.000Z', status: 'OVERDUE' }),
        invoice({ id: 'paga-junho', dueAt: '2026-06-10T00:00:00.000Z' }),
      ],
      AGORA,
      MESES_DO_HISTORICO,
    );

    expect(linhas[0]?.invoiceId).toBe('aberta');
    expect(linhas[0]?.emAberto).toBe(true);
  });

  it('NÃO corta fatura em aberto por idade, mesmo muito antiga', () => {
    // O defeito que este teste existe para impedir: cortar por janela de
    // tempo linha a linha some com a divida em vez de erra-la, e o totem
    // passa a afirmar por omissao que nao ha o que pagar. A vencida ha um
    // ano e exatamente a que trouxe o aluno ate aqui.
    const linhas = recortarHistorico(
      [invoice({ id: 'antiga', dueAt: '2025-06-10T00:00:00.000Z', status: 'OVERDUE' })],
      AGORA,
      MESES_DO_HISTORICO,
    );

    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.invoiceId).toBe('antiga');
  });

  it('corta fatura FECHADA fora da janela de meses', () => {
    const linhas = recortarHistorico(
      [
        invoice({ id: 'dentro', dueAt: '2026-07-10T00:00:00.000Z' }),
        invoice({ id: 'fora', dueAt: '2025-06-10T00:00:00.000Z' }),
      ],
      AGORA,
      MESES_DO_HISTORICO,
    );

    expect(linhas.map((l) => l.invoiceId)).toEqual(['dentro']);
  });

  it('ordena abertas da mais antiga para a mais nova', () => {
    const linhas = recortarHistorico(
      [
        invoice({ id: 'nova', dueAt: '2026-08-10T00:00:00.000Z', status: 'OPEN' }),
        invoice({ id: 'velha', dueAt: '2026-06-10T00:00:00.000Z', status: 'OVERDUE' }),
      ],
      AGORA,
      MESES_DO_HISTORICO,
    );

    expect(linhas.map((l) => l.invoiceId)).toEqual(['velha', 'nova']);
  });

  it('ordena fechadas da mais recente para a mais antiga', () => {
    const linhas = recortarHistorico(
      [
        invoice({ id: 'junho', dueAt: '2026-06-10T00:00:00.000Z' }),
        invoice({ id: 'agosto', dueAt: '2026-08-10T00:00:00.000Z' }),
        invoice({ id: 'julho', dueAt: '2026-07-10T00:00:00.000Z' }),
      ],
      AGORA,
      MESES_DO_HISTORICO,
    );

    expect(linhas.map((l) => l.invoiceId)).toEqual(['agosto', 'julho', 'junho']);
  });

  it('desempata por id quando o vencimento é o mesmo', () => {
    // Sem desempate a ordem cai na fisica do Postgres, que muda depois de
    // qualquer UPDATE -- a linha pularia de lugar entre dois carregamentos.
    const linhas = recortarHistorico(
      [
        invoice({ id: 'bbb', dueAt: '2026-07-10T00:00:00.000Z' }),
        invoice({ id: 'aaa', dueAt: '2026-07-10T00:00:00.000Z' }),
      ],
      AGORA,
      MESES_DO_HISTORICO,
    );

    expect(linhas.map((l) => l.invoiceId)).toEqual(['aaa', 'bbb']);
  });

  it('limita ao número de meses pedido', () => {
    const muitas = Array.from({ length: 12 }, (_, i) =>
      invoice({ id: `f${i}`, dueAt: `2026-0${(i % 8) + 1}-10T00:00:00.000Z` }),
    );

    expect(recortarHistorico(muitas, AGORA, MESES_DO_HISTORICO)).toHaveLength(MESES_DO_HISTORICO);
  });

  it('marca emAberto só para OPEN e OVERDUE', () => {
    const linhas = recortarHistorico(
      [
        invoice({ id: 'open', dueAt: '2026-08-10T00:00:00.000Z', status: 'OPEN' }),
        invoice({ id: 'overdue', dueAt: '2026-08-11T00:00:00.000Z', status: 'OVERDUE' }),
        invoice({ id: 'paid', dueAt: '2026-08-12T00:00:00.000Z', status: 'PAID' }),
        invoice({ id: 'cancelled', dueAt: '2026-08-13T00:00:00.000Z', status: 'CANCELLED' }),
      ],
      AGORA,
      MESES_DO_HISTORICO,
    );

    const porId = new Map(linhas.map((l) => [l.invoiceId, l.emAberto]));

    expect(porId.get('open')).toBe(true);
    expect(porId.get('overdue')).toBe(true);
    expect(porId.get('paid')).toBe(false);
    expect(porId.get('cancelled')).toBe(false);
  });
});
