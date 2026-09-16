import { describe, expect, it } from '@jest/globals';

import {
  concederPorEvento,
  concederPorSessao,
  mesAnterior,
  mesLocal,
  reverter,
  somarSaldo,
} from './movimento-de-xp.js';
import type { VersaoDeRegra } from './regra-de-xp.js';

const regra: VersaoDeRegra = {
  id: 'r1',
  code: 'treino-diario',
  version: 1,
  trigger: 'SESSAO_CONFIRMADA',
  points: 10,
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  effectiveTo: null,
};

describe('mesLocal', () => {
  it('usa o fuso da UNIDADE, nao o do processo', () => {
    // 01/09 02:00 UTC e ainda 31/08 em Sao Paulo (UTC-3, sem DST desde 2019).
    expect(mesLocal(new Date('2026-09-01T02:00:00Z'), 'America/Sao_Paulo')).toBe('2026-08');
  });

  it('vira o mes quando o fuso local ja virou', () => {
    expect(mesLocal(new Date('2026-09-01T04:00:00Z'), 'America/Sao_Paulo')).toBe('2026-09');
  });
});

describe('mesAnterior', () => {
  it('subtrai um mes dentro do mesmo ano', () => {
    expect(mesAnterior('2026-09')).toBe('2026-08');
  });

  it('vira o ano em janeiro', () => {
    expect(mesAnterior('2026-01')).toBe('2025-12');
  });
});

describe('concederPorSessao', () => {
  it('carrega origem e versao de regra', () => {
    const movimento = concederPorSessao({
      regra,
      sessionId: 'sess-1',
      occurredAt: new Date('2026-08-10T12:00:00Z'),
      fusoDaUnidade: 'America/Sao_Paulo',
    });

    expect(movimento).toMatchObject({
      type: 'GRANT',
      points: 10,
      ruleVersionId: 'r1',
      sourceKind: 'ATTENDANCE_SESSION',
      sourceId: 'sess-1',
      reversesEntryId: null,
      localMonth: '2026-08',
    });
  });
});

describe('concederPorEvento', () => {
  const regraDeMeta: VersaoDeRegra = {
    id: 'r2',
    code: 'meta-atingida',
    version: 1,
    trigger: 'META_ATINGIDA',
    points: 100,
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    effectiveTo: null,
  };

  it('carrega a origem GENERIC_EVENT e a versao de regra, sem sessao', () => {
    const movimento = concederPorEvento({
      regra: regraDeMeta,
      sourceKind: 'HEALTH_GOAL',
      sourceId: 'goal-1',
      occurredAt: new Date('2026-08-10T12:00:00Z'),
      fusoDaUnidade: 'America/Sao_Paulo',
    });

    expect(movimento).toMatchObject({
      type: 'GRANT',
      points: 100,
      ruleVersionId: 'r2',
      sourceKind: 'HEALTH_GOAL',
      sourceId: 'goal-1',
      reversesEntryId: null,
      localMonth: '2026-08',
    });
  });
});

describe('reverter', () => {
  it('compensa com sinal oposto e vincula o original', () => {
    const original = {
      id: 'e1',
      points: 10,
      ruleVersionId: 'r1',
      sourceKind: 'ATTENDANCE_SESSION' as const,
      sourceId: 'sess-1',
      occurredAt: new Date('2026-08-10T12:00:00Z'),
      localMonth: '2026-08',
    };

    expect(reverter(original, 'passagem corrigida')).toMatchObject({
      type: 'REVERSAL',
      points: -10,
      reversesEntryId: 'e1',
      reason: 'passagem corrigida',
      /* O mes do FATO ORIGINAL, nao o da correcao: senao o estorno cairia
       * em setembro e agosto ficaria com o ponto que nao vale mais. */
      localMonth: '2026-08',
    });
  });

  it('exige motivo', () => {
    const original = {
      id: 'e1',
      points: 10,
      ruleVersionId: 'r1',
      sourceKind: 'ATTENDANCE_SESSION' as const,
      sourceId: 'sess-1',
      occurredAt: new Date('2026-08-10T12:00:00Z'),
      localMonth: '2026-08',
    };

    expect(() => reverter(original, '  ')).toThrow('XP_MOTIVO_OBRIGATORIO');
  });
});

describe('somarSaldo', () => {
  it('soma concessao e estorno', () => {
    expect(somarSaldo([{ points: 10 }, { points: 10 }, { points: -10 }])).toBe(10);
  });

  it('lista vazia soma zero', () => {
    expect(somarSaldo([])).toBe(0);
  });
});
