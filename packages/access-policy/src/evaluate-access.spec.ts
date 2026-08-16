import { describe, expect, it } from '@jest/globals';

import { evaluateAccess } from './evaluate-access.js';
import {
  POLICY_VERSION,
  type AccessPolicyInput,
  type AccessWindow,
  type EntitlementInput,
  type StudentStatus,
} from './types.js';

/**
 * Tabela de decisao -- `M1-FR-020`, `M1-FR-021`, `M1-BR-002`, `M1-BR-003`,
 * `M1-BR-006`.
 *
 * Escrita ANTES do motor (plano F9, Task 1, Step 1). Cada linha e um caso que
 * a operacao consegue reproduzir na recepcao; nenhuma testa detalhe interno.
 */

const UNIDADE = 'unit-centro';
const OUTRA_UNIDADE = 'unit-bairro';

/** Quarta-feira, 14:00 local. Longe de qualquer borda de dia ou janela. */
const QUARTA_14H = { localDayOfWeek: 3, localMinuteOfDay: 14 * 60 };

function entitlement(sobrescreve: Partial<EntitlementInput> = {}): EntitlementInput {
  return {
    id: 'ent-1',
    status: 'ACTIVE',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-12-31T23:59:59.000Z',
    unitIds: [UNIDADE],
    windows: [],
    ...sobrescreve,
  };
}

function entrada(sobrescreve: Partial<AccessPolicyInput> = {}): AccessPolicyInput {
  return {
    evaluatedAt: '2026-08-12T17:00:00.000Z',
    unitId: UNIDADE,
    ...QUARTA_14H,
    student: { status: 'ACTIVE' },
    entitlements: [entitlement()],
    adminBlock: { active: false },
    ...sobrescreve,
  };
}

describe('evaluateAccess -- caminho de entrada', () => {
  it('libera aluno ativo com direito vigente na unidade e no horario', () => {
    const resultado = evaluateAccess(entrada());

    expect(resultado).toEqual({
      outcome: 'ALLOW',
      reason: 'ACTIVE_ENTITLEMENT',
      entitlementId: 'ent-1',
      validUntil: '2026-12-31T23:59:59.000Z',
      policyVersion: POLICY_VERSION,
    });
  });

  it('libera quando o entitlement nao tem janela -- sem janela e sem restricao de horario', () => {
    const resultado = evaluateAccess(
      entrada({ entitlements: [entitlement({ windows: [] })], localMinuteOfDay: 3 * 60 }),
    );

    expect(resultado.outcome).toBe('ALLOW');
  });
});

describe('evaluateAccess -- estado do aluno (M1-BR-002)', () => {
  it('nega BLOCKED com rotulo proprio, distinto de inativo', () => {
    const resultado = evaluateAccess(entrada({ student: { status: 'BLOCKED' } }));

    expect(resultado).toEqual({
      outcome: 'DENY',
      reason: 'STUDENT_BLOCKED',
      policyVersion: POLICY_VERSION,
    });
  });

  it.each<StudentStatus>(['LEAD', 'TRIAL', 'SUSPENDED', 'CANCELLED', 'ARCHIVED'])(
    'nega aluno %s como STUDENT_INACTIVE mesmo com direito vigente',
    (status) => {
      const resultado = evaluateAccess(entrada({ student: { status } }));

      expect(resultado).toEqual({
        outcome: 'DENY',
        reason: 'STUDENT_INACTIVE',
        policyVersion: POLICY_VERSION,
      });
    },
  );
});

describe('evaluateAccess -- direito (M1-BR-003)', () => {
  it('nega quando nao ha nenhum entitlement', () => {
    const resultado = evaluateAccess(entrada({ entitlements: [] }));

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'NO_ENTITLEMENT' });
  });

  it.each<EntitlementInput['status']>(['SCHEDULED', 'SUSPENDED', 'REVOKED', 'EXPIRED'])(
    'nega entitlement %s -- so ACTIVE abre catraca',
    (status) => {
      const resultado = evaluateAccess(entrada({ entitlements: [entitlement({ status })] }));

      expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'NO_ENTITLEMENT' });
    },
  );

  it('nega direito que ainda nao comecou', () => {
    const resultado = evaluateAccess(
      entrada({
        entitlements: [entitlement({ startsAt: '2026-09-01T00:00:00.000Z' })],
      }),
    );

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'NO_ENTITLEMENT' });
  });

  it('nega direito ja expirado', () => {
    const resultado = evaluateAccess(
      entrada({
        entitlements: [entitlement({ endsAt: '2026-08-01T00:00:00.000Z' })],
      }),
    );

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'NO_ENTITLEMENT' });
  });

  it('libera no instante exato do fim -- endsAt e inclusivo', () => {
    const resultado = evaluateAccess(
      entrada({
        evaluatedAt: '2026-08-12T17:00:00.000Z',
        entitlements: [entitlement({ endsAt: '2026-08-12T17:00:00.000Z' })],
      }),
    );

    expect(resultado.outcome).toBe('ALLOW');
  });

  it('nega um segundo depois do fim', () => {
    const resultado = evaluateAccess(
      entrada({
        evaluatedAt: '2026-08-12T17:00:01.000Z',
        entitlements: [entitlement({ endsAt: '2026-08-12T17:00:00.000Z' })],
      }),
    );

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'NO_ENTITLEMENT' });
  });

  it('libera no instante exato do inicio -- startsAt e inclusivo', () => {
    const resultado = evaluateAccess(
      entrada({
        evaluatedAt: '2026-08-12T17:00:00.000Z',
        entitlements: [entitlement({ startsAt: '2026-08-12T17:00:00.000Z' })],
      }),
    );

    expect(resultado.outcome).toBe('ALLOW');
  });
});

describe('evaluateAccess -- unidade (ADR-024, WRONG_UNIT)', () => {
  it('nega com WRONG_UNIT quando o direito vale so em outra unidade', () => {
    const resultado = evaluateAccess(
      entrada({ entitlements: [entitlement({ unitIds: [OUTRA_UNIDADE] })] }),
    );

    expect(resultado).toEqual({
      outcome: 'DENY',
      reason: 'WRONG_UNIT',
      policyVersion: POLICY_VERSION,
    });
  });

  it('nega com WRONG_UNIT, nao NO_ENTITLEMENT -- as duas negativas pedem acoes opostas', () => {
    const semDireito = evaluateAccess(entrada({ entitlements: [] }));
    const unidadeErrada = evaluateAccess(
      entrada({ entitlements: [entitlement({ unitIds: [OUTRA_UNIDADE] })] }),
    );

    expect(semDireito).toMatchObject({ reason: 'NO_ENTITLEMENT' });
    expect(unidadeErrada).toMatchObject({ reason: 'WRONG_UNIT' });
  });

  it('nega quando a lista de unidades esta vazia -- vazio e nenhuma, nunca todas', () => {
    const resultado = evaluateAccess(entrada({ entitlements: [entitlement({ unitIds: [] })] }));

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'WRONG_UNIT' });
  });

  it('libera quando o direito cobre varias unidades incluindo esta', () => {
    const resultado = evaluateAccess(
      entrada({ entitlements: [entitlement({ unitIds: [OUTRA_UNIDADE, UNIDADE] })] }),
    );

    expect(resultado.outcome).toBe('ALLOW');
  });
});

describe('evaluateAccess -- janela de horario', () => {
  const manha: AccessWindow = { dayOfWeek: 3, startMinute: 6 * 60, endMinute: 12 * 60 };
  const tarde: AccessWindow = { dayOfWeek: 3, startMinute: 13 * 60, endMinute: 22 * 60 };

  it('libera dentro da janela', () => {
    const resultado = evaluateAccess(
      entrada({ entitlements: [entitlement({ windows: [tarde] })] }),
    );

    expect(resultado.outcome).toBe('ALLOW');
  });

  it('nega antes da janela abrir', () => {
    const resultado = evaluateAccess(
      entrada({
        entitlements: [entitlement({ windows: [tarde] })],
        localMinuteOfDay: 12 * 60 + 59,
      }),
    );

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'OUTSIDE_SCHEDULE' });
  });

  it('nega depois da janela fechar', () => {
    const resultado = evaluateAccess(
      entrada({
        entitlements: [entitlement({ windows: [tarde] })],
        localMinuteOfDay: 22 * 60 + 1,
      }),
    );

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'OUTSIDE_SCHEDULE' });
  });

  it('libera no minuto exato de abertura -- borda inclusiva', () => {
    const resultado = evaluateAccess(
      entrada({ entitlements: [entitlement({ windows: [tarde] })], localMinuteOfDay: 13 * 60 }),
    );

    expect(resultado.outcome).toBe('ALLOW');
  });

  it('libera no minuto exato de fechamento -- borda inclusiva', () => {
    const resultado = evaluateAccess(
      entrada({ entitlements: [entitlement({ windows: [tarde] })], localMinuteOfDay: 22 * 60 }),
    );

    expect(resultado.outcome).toBe('ALLOW');
  });

  it('nega no dia errado da semana mesmo no horario certo', () => {
    const resultado = evaluateAccess(
      entrada({
        entitlements: [entitlement({ windows: [tarde] })],
        localDayOfWeek: 4,
      }),
    );

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'OUTSIDE_SCHEDULE' });
  });

  it('libera quando o instante cai em uma de varias janelas do mesmo dia', () => {
    const resultado = evaluateAccess(
      entrada({
        entitlements: [entitlement({ windows: [manha, tarde] })],
        localMinuteOfDay: 8 * 60,
      }),
    );

    expect(resultado.outcome).toBe('ALLOW');
  });

  it('nega no intervalo entre duas janelas do mesmo dia', () => {
    const resultado = evaluateAccess(
      entrada({
        entitlements: [entitlement({ windows: [manha, tarde] })],
        localMinuteOfDay: 12 * 60 + 30,
      }),
    );

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'OUTSIDE_SCHEDULE' });
  });
});

describe('evaluateAccess -- bloqueio administrativo (M1-BR-006)', () => {
  it('nega mesmo com aluno ativo e direito perfeito', () => {
    const resultado = evaluateAccess(entrada({ adminBlock: { active: true } }));

    expect(resultado).toEqual({
      outcome: 'DENY',
      reason: 'ADMIN_BLOCK',
      policyVersion: POLICY_VERSION,
    });
  });

  it('precede o estado do aluno -- bloqueio vence e reporta ADMIN_BLOCK', () => {
    const resultado = evaluateAccess(
      entrada({ student: { status: 'BLOCKED' }, adminBlock: { active: true } }),
    );

    expect(resultado).toMatchObject({ reason: 'ADMIN_BLOCK' });
  });
});

describe('evaluateAccess -- precedencia restritiva com direitos sobrepostos', () => {
  it('escolhe o direito que expira PRIMEIRO', () => {
    const resultado = evaluateAccess(
      entrada({
        entitlements: [
          entitlement({ id: 'ent-longo', endsAt: '2026-12-31T00:00:00.000Z' }),
          entitlement({ id: 'ent-curto', endsAt: '2026-08-20T00:00:00.000Z' }),
        ],
      }),
    );

    expect(resultado).toMatchObject({
      outcome: 'ALLOW',
      entitlementId: 'ent-curto',
      validUntil: '2026-08-20T00:00:00.000Z',
    });
  });

  it('nao deixa direito de outra unidade emprestar validade ao desta', () => {
    const resultado = evaluateAccess(
      entrada({
        entitlements: [
          entitlement({ id: 'ent-outra', unitIds: [OUTRA_UNIDADE], endsAt: '2026-08-15T00:00:00.000Z' }),
          entitlement({ id: 'ent-desta', endsAt: '2026-11-01T00:00:00.000Z' }),
        ],
      }),
    );

    expect(resultado).toMatchObject({ entitlementId: 'ent-desta' });
  });

  it('nega quando um direito serve a unidade e outro o horario, mas nenhum os dois', () => {
    const resultado = evaluateAccess(
      entrada({
        entitlements: [
          entitlement({ id: 'ent-unidade-ok', windows: [{ dayOfWeek: 0, startMinute: 0, endMinute: 60 }] }),
          entitlement({ id: 'ent-horario-ok', unitIds: [OUTRA_UNIDADE] }),
        ],
      }),
    );

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'OUTSIDE_SCHEDULE' });
  });
});

describe('evaluateAccess -- dado corrompido nunca vira ALLOW', () => {
  it('nega quando evaluatedAt e invalido', () => {
    const resultado = evaluateAccess(entrada({ evaluatedAt: 'nao-e-data' }));

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'NO_ENTITLEMENT' });
  });

  it('nega quando as datas do entitlement sao invalidas', () => {
    const resultado = evaluateAccess(
      entrada({ entitlements: [entitlement({ endsAt: 'tambem-nao' })] }),
    );

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'NO_ENTITLEMENT' });
  });
});
