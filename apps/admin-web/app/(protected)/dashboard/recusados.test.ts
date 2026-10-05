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
  student: quem.nome ? { id: `aluno-${quem.nome}`, fullName: quem.nome } : null,
  externalUserId: quem.numero ?? null,
});

describe('recusadosDoDia', () => {
  it('so entra quem foi recusado', () => {
    const r = recusadosDoDia([
      evento('1', 'ALLOW', { nome: 'Nanci Santana' }, '2026-10-02T12:17:00Z'),
      evento('2', 'DENY', { nome: 'Joao Pedro' }, '2026-10-02T12:10:00Z'),
    ]);

    expect(r.map((x) => x.evento.student?.fullName)).toEqual(['Joao Pedro']);
  });

  it('uma linha por pessoa, com a recusa mais recente e quantas vezes', () => {
    const r = recusadosDoDia([
      evento('3', 'DENY', { nome: 'Joao Pedro' }, '2026-10-02T12:30:00Z', 'NO_ENTITLEMENT'),
      evento('2', 'DENY', { nome: 'Joao Pedro' }, '2026-10-02T12:10:00Z', 'STUDENT_BLOCKED'),
    ]);

    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ chave: 'aluno:aluno-Joao Pedro', vezes: 2 });
    expect(r[0]?.evento).toMatchObject({ id: '3', reason: 'NO_ENTITLEMENT' });
  });

  it('quem nao foi identificado aparece pelo numero do leitor', () => {
    const r = recusadosDoDia([evento('1', 'DENY', { numero: '1558' }, '2026-10-02T12:00:00Z')]);

    expect(r).toMatchObject([{ chave: 'numero:1558', vezes: 1 }]);
    expect(r[0]?.evento.externalUserId).toBe('1558');
  });

  it('nenhuma recusa, lista vazia', () => {
    expect(recusadosDoDia([])).toEqual([]);
  });
});
