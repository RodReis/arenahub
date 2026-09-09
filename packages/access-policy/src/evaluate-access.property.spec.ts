import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { evaluateAccess } from './evaluate-access.js';
import { POLICY_VERSION, type AccessPolicyInput, type EntitlementStatus, type StudentStatus } from './types.js';

/**
 * Property tests -- plano F9, Task 1, Step 4.
 *
 * A tabela prova casos que alguem imaginou. Estes provam invariantes sobre
 * entradas que ninguem imaginou -- que e onde mora a liberacao indevida.
 *
 * `M1-AC-006` e o `DEFINITION OF DONE` da fatia dizem a mesma coisa por
 * angulos diferentes: nenhuma falha, timeout ou dado ausente vira ALLOW.
 * Aqui isso deixa de ser intencao e vira propriedade verificada.
 */

const STATUS_ALUNO: StudentStatus[] = [
  'LEAD',
  'TRIAL',
  'ACTIVE',
  'SUSPENDED',
  'BLOCKED',
  'CANCELLED',
  'ARCHIVED',
];

const STATUS_DIREITO: EntitlementStatus[] = [
  'SCHEDULED',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
  'EXPIRED',
];

/** Instantes dentro de uma faixa realista -- 2025 a 2028. */
const instante = fc
  .integer({ min: Date.parse('2025-01-01T00:00:00.000Z'), max: Date.parse('2028-12-31T00:00:00.000Z') })
  .map((ms) => new Date(ms).toISOString());

const janela = fc
  .record({
    dayOfWeek: fc.integer({ min: 0, max: 6 }),
    inicio: fc.integer({ min: 0, max: 1439 }),
    duracao: fc.integer({ min: 0, max: 1439 }),
  })
  .map(({ dayOfWeek, inicio, duracao }) => ({
    dayOfWeek,
    startMinute: inicio,
    endMinute: Math.min(inicio + duracao, 1439),
  }));

const entitlementArb = fc.record({
  id: fc.uuid(),
  status: fc.constantFrom(...STATUS_DIREITO),
  startsAt: instante,
  endsAt: instante,
  unitIds: fc.array(fc.constantFrom('unit-a', 'unit-b', 'unit-c'), { maxLength: 3 }),
  windows: fc.array(janela, { maxLength: 4 }),
});

const entradaArb: fc.Arbitrary<AccessPolicyInput> = fc.record({
  evaluatedAt: instante,
  unitId: fc.constantFrom('unit-a', 'unit-b', 'unit-c'),
  localDayOfWeek: fc.integer({ min: 0, max: 6 }),
  localMinuteOfDay: fc.integer({ min: 0, max: 1439 }),
  student: fc.record({ status: fc.constantFrom(...STATUS_ALUNO) }),
  entitlements: fc.array(entitlementArb, { maxLength: 5 }),
  adminBlock: fc.record({ active: fc.boolean() }),
  tenant: fc.record({ gateActive: fc.constant(false) }),
});

describe('propriedade: determinismo', () => {
  it('a mesma entrada devolve sempre a mesma saida', () => {
    fc.assert(
      fc.property(entradaArb, (entrada) => {
        expect(evaluateAccess(entrada)).toEqual(evaluateAccess(entrada));
      }),
      { numRuns: 500 },
    );
  });

  it('nunca lanca excecao, para qualquer entrada bem tipada', () => {
    fc.assert(
      fc.property(entradaArb, (entrada) => {
        expect(() => evaluateAccess(entrada)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });

  it('sempre carimba a versao da politica', () => {
    fc.assert(
      fc.property(entradaArb, (entrada) => {
        expect(evaluateAccess(entrada).policyVersion).toBe(POLICY_VERSION);
      }),
      { numRuns: 200 },
    );
  });
});

describe('propriedade: bloqueio administrativo domina (M1-BR-006)', () => {
  it('bloqueio ativo sempre nega, qualquer que seja o resto', () => {
    fc.assert(
      fc.property(entradaArb, (entrada) => {
        const resultado = evaluateAccess({ ...entrada, adminBlock: { active: true } });

        expect(resultado).toEqual({
          outcome: 'DENY',
          reason: 'ADMIN_BLOCK',
          policyVersion: POLICY_VERSION,
        });
      }),
      { numRuns: 500 },
    );
  });
});

describe('propriedade: gate do contratante domina (F65, ADR-053)', () => {
  it('gate ativo nega SEMPRE, qualquer que seja o resto da entrada', () => {
    fc.assert(
      fc.property(entradaArb, (entrada) => {
        const resultado = evaluateAccess({ ...entrada, tenant: { gateActive: true } });

        expect(resultado.outcome).toBe('DENY');
        expect(resultado.reason).toBe('TENANT_SUSPENDED');
      }),
    );
  });
});

describe('propriedade: aluno nao-ACTIVE nunca entra (M1-BR-002)', () => {
  it('qualquer status diferente de ACTIVE nega, mesmo com direitos perfeitos', () => {
    fc.assert(
      fc.property(
        entradaArb,
        fc.constantFrom(...STATUS_ALUNO.filter((s) => s !== 'ACTIVE')),
        (entrada, status) => {
          const resultado = evaluateAccess({
            ...entrada,
            student: { status },
            adminBlock: { active: false },
          });

          expect(resultado.outcome).toBe('DENY');
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('propriedade: direito nao vigente nunca libera', () => {
  it('entitlement expirado nunca retorna ALLOW -- exigencia literal do PRD §17', () => {
    fc.assert(
      fc.property(entradaArb, (entrada) => {
        const avaliadoEm = Date.parse(entrada.evaluatedAt);

        // Empurra TODO direito para o passado.
        const expirados = entrada.entitlements.map((e) => ({
          ...e,
          startsAt: new Date(avaliadoEm - 86_400_000 * 30).toISOString(),
          endsAt: new Date(avaliadoEm - 1000).toISOString(),
        }));

        const resultado = evaluateAccess({ ...entrada, entitlements: expirados });

        expect(resultado.outcome).toBe('DENY');
      }),
      { numRuns: 500 },
    );
  });

  it.each(STATUS_DIREITO.filter((s) => s !== 'ACTIVE'))(
    'nenhum direito %s produz ALLOW',
    (status) => {
      fc.assert(
        fc.property(entradaArb, (entrada) => {
          const resultado = evaluateAccess({
            ...entrada,
            entitlements: entrada.entitlements.map((e) => ({ ...e, status })),
          });

          expect(resultado.outcome).toBe('DENY');
        }),
        { numRuns: 200 },
      );
    },
  );
});

describe('propriedade: unidade errada nunca libera', () => {
  it('direito que nao lista a unidade avaliada nunca produz ALLOW', () => {
    fc.assert(
      fc.property(entradaArb, (entrada) => {
        const semAUnidade = entrada.entitlements.map((e) => ({
          ...e,
          unitIds: e.unitIds.filter((u) => u !== entrada.unitId),
        }));

        const resultado = evaluateAccess({ ...entrada, entitlements: semAUnidade });

        expect(resultado.outcome).toBe('DENY');
      }),
      { numRuns: 500 },
    );
  });
});

describe('propriedade: coerencia da saida', () => {
  it('todo ALLOW aponta um entitlement REAL, vigente, desta unidade', () => {
    fc.assert(
      fc.property(entradaArb, (entrada) => {
        const resultado = evaluateAccess(entrada);

        if (resultado.outcome !== 'ALLOW') return;

        const usado = entrada.entitlements.find((e) => e.id === resultado.entitlementId);

        expect(usado).toBeDefined();
        expect(usado!.status).toBe('ACTIVE');
        expect(usado!.unitIds).toContain(entrada.unitId);
      }),
      { numRuns: 500 },
    );
  });

  it('validUntil de um ALLOW nunca e anterior ao instante avaliado', () => {
    fc.assert(
      fc.property(entradaArb, (entrada) => {
        const resultado = evaluateAccess(entrada);

        if (resultado.outcome !== 'ALLOW') return;

        expect(Date.parse(resultado.validUntil)).toBeGreaterThanOrEqual(
          Date.parse(entrada.evaluatedAt),
        );
      }),
      { numRuns: 500 },
    );
  });

  it('validUntil e o MENOR prazo entre os direitos elegiveis -- nunca emprestado', () => {
    fc.assert(
      fc.property(entradaArb, (entrada) => {
        const resultado = evaluateAccess(entrada);

        if (resultado.outcome !== 'ALLOW') return;

        const avaliadoEm = Date.parse(entrada.evaluatedAt);

        const elegiveis = entrada.entitlements.filter(
          (e) =>
            e.status === 'ACTIVE' &&
            e.unitIds.includes(entrada.unitId) &&
            Date.parse(e.startsAt) <= avaliadoEm &&
            Date.parse(e.endsAt) >= avaliadoEm &&
            (e.windows.length === 0 ||
              e.windows.some(
                (j) =>
                  j.dayOfWeek === entrada.localDayOfWeek &&
                  entrada.localMinuteOfDay >= j.startMinute &&
                  entrada.localMinuteOfDay <= j.endMinute,
              )),
        );

        const menorPrazo = Math.min(...elegiveis.map((e) => Date.parse(e.endsAt)));

        expect(Date.parse(resultado.validUntil)).toBe(menorPrazo);
      }),
      { numRuns: 500 },
    );
  });

  it('ALLOW so acontece com reason ACTIVE_ENTITLEMENT', () => {
    fc.assert(
      fc.property(entradaArb, (entrada) => {
        const resultado = evaluateAccess(entrada);

        if (resultado.outcome === 'ALLOW') {
          expect(resultado.reason).toBe('ACTIVE_ENTITLEMENT');
        }
      }),
      { numRuns: 300 },
    );
  });
});
