import { describe, expect, it } from 'vitest';

import type { EventoDoFeed } from '../../actions/dashboard';
import { JANELA_DE_PERMANENCIA_MIN, naJanelaDePermanencia, tempoDesde } from './permanencia';

const AGORA = Date.parse('2026-10-02T23:00:00.000Z');

const evento = (id: string, minutosAtras: number): EventoDoFeed => ({
  id,
  occurredAt: new Date(AGORA - minutosAtras * 60_000).toISOString(),
  outcome: 'ALLOW',
  reason: 'ACESSO_LIBERADO',
  method: 'FACIAL',
  student: { id: `aluno-${id}`, fullName: id },
  externalUserId: null,
});

describe('naJanelaDePermanencia', () => {
  it('a janela é de 90 minutos, a média de treino na Arena Positiva', () => {
    expect(JANELA_DE_PERMANENCIA_MIN).toBe(90);
  });

  it('mantém quem entrou dentro da janela e tira quem entrou antes', () => {
    const eventos = [evento('recente', 5), evento('limite', 90), evento('antigo', 91)];

    expect(naJanelaDePermanencia(eventos, AGORA).map((e) => e.id)).toEqual(['recente', 'limite']);
  });

  it('preserva a ordem recebida (do mais recente para o mais antigo)', () => {
    const eventos = [evento('c', 1), evento('b', 30), evento('a', 80)];

    expect(naJanelaDePermanencia(eventos, AGORA).map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('a mesma lista com o relógio adiantado perde quem saiu da janela', () => {
    const eventos = [evento('x', 85)];
    const seteMinutosDepois = AGORA + 7 * 60_000;

    expect(naJanelaDePermanencia(eventos, AGORA)).toHaveLength(1);
    expect(naJanelaDePermanencia(eventos, seteMinutosDepois)).toHaveLength(0);
  });

  it('mantém negados dentro da janela: a recepção precisa vê-los na hora', () => {
    const negado: EventoDoFeed = { ...evento('negado', 2), outcome: 'DENY', reason: 'NO_ENTITLEMENT' };

    expect(naJanelaDePermanencia([negado], AGORA)).toHaveLength(1);
  });
});

describe('tempoDesde', () => {
  const ha = (ms: number) => new Date(AGORA - ms).toISOString();

  it.each([
    [0, 'agora'],
    [59_000, 'agora'],
    [60_000, '1 min'],
    [12 * 60_000 + 30_000, '12 min'],
    [59 * 60_000, '59 min'],
    [60 * 60_000, '1h'],
    [65 * 60_000, '1h05'],
    [89 * 60_000, '1h29'],
  ])('%i ms atrás vira "%s"', (ms, esperado) => {
    expect(tempoDesde(ha(ms), AGORA)).toBe(esperado);
  });

  it('relógio do equipamento adiantado não vira tempo negativo', () => {
    expect(tempoDesde(ha(-30_000), AGORA)).toBe('agora');
  });
});
