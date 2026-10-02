import { describe, expect, it } from 'vitest';

import type { EventoDoFeed } from '../../actions/dashboard';
import { recusadosDoDia } from './recusados';

const evento = (
  id: string,
  outcome: 'ALLOW' | 'DENY',
  quem: { nome?: string; numero?: string },
  occurredAt: string,
  reason = 'NO_ENTITLEMENT',
): EventoDoFeed => ({
  id,
  occurredAt,
  outcome,
  reason,
  method: 'FACIAL',
  student: quem.nome ? { fullName: quem.nome } : null,
  externalUserId: quem.numero ?? null,
});

describe('recusadosDoDia', () => {
  it('so entra quem foi recusado', () => {
    const r = recusadosDoDia([
      evento('1', 'ALLOW', { nome: 'Nanci Santana' }, '2026-10-02T12:17:00Z'),
      evento('2', 'DENY', { nome: 'Joao Pedro' }, '2026-10-02T12:10:00Z'),
    ]);

    expect(r.map((x) => x.nome)).toEqual(['Joao Pedro']);
  });

  it('uma linha por pessoa, com a recusa mais recente e quantas vezes', () => {
    const r = recusadosDoDia([
      evento('3', 'DENY', { nome: 'Joao Pedro' }, '2026-10-02T12:30:00Z', 'NO_ENTITLEMENT'),
      evento('2', 'DENY', { nome: 'Joao Pedro' }, '2026-10-02T12:10:00Z', 'STUDENT_BLOCKED'),
    ]);

    expect(r).toEqual([
      {
        chave: 'aluno:Joao Pedro',
        nome: 'Joao Pedro',
        occurredAt: '2026-10-02T12:30:00Z',
        reason: 'NO_ENTITLEMENT',
        vezes: 2,
      },
    ]);
  });

  it('quem nao foi identificado aparece pelo numero do leitor', () => {
    const r = recusadosDoDia([evento('1', 'DENY', { numero: '1558' }, '2026-10-02T12:00:00Z')]);

    expect(r).toMatchObject([{ nome: '1558', vezes: 1 }]);
  });

  it('nenhuma recusa, lista vazia', () => {
    expect(recusadosDoDia([])).toEqual([]);
  });
});
