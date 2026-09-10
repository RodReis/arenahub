import { describe, expect, it } from '@jest/globals';

import { evaluateAccess } from './evaluate-access.js';
import { resolverHoraLocal } from './local-time.js';
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
    tenant: { gateActive: false },
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

  it.each<EntitlementInput['status']>(['SCHEDULED', 'REVOKED', 'EXPIRED'])(
    'nega entitlement %s -- so ACTIVE abre catraca',
    (status) => {
      const resultado = evaluateAccess(entrada({ entitlements: [entitlement({ status })] }));

      expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'NO_ENTITLEMENT' });
    },
  );

  /**
   * `SUSPENDED` SAIU da lista acima na F15.
   *
   * O desfecho continua `DENY` -- ninguem passou a entrar. O que mudou e o
   * `reason`, e ele e o campo que responde "por que este aluno nao passou?".
   * "Nao tem plano" manda a recepcao vender um; "esta devendo" manda cobrar.
   * Colapsadas, a tela dizia a mesma coisa nos dois casos.
   */
  it('nega entitlement SUSPENDED com razao PROPRIA -- e devedor, nao sem-plano', () => {
    const resultado = evaluateAccess(
      entrada({ entitlements: [entitlement({ status: 'SUSPENDED' })] }),
    );

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'PAYMENT_OVERDUE' });
  });

  it('suspenso com periodo JA VENCIDO volta a ser NO_ENTITLEMENT', () => {
    /**
     * Um direito suspenso cujo periodo acabou nao e inadimplencia: e plano
     * vencido. Dizer "pague para liberar" a quem nao tem mais plano mandaria
     * a recepcao cobrar uma divida que nao existe.
     */
    const resultado = evaluateAccess(
      entrada({
        entitlements: [
          entitlement({
            status: 'SUSPENDED',
            startsAt: '2026-01-01T00:00:00.000Z',
            endsAt: '2026-02-01T00:00:00.000Z',
          }),
        ],
      }),
    );

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'NO_ENTITLEMENT' });
  });

  it('suspenso NAO ganha razao propria quando existe outro direito ATIVO', () => {
    /**
     * Aluno com dois planos, um suspenso e um em dia, ENTRA -- e o motor nao
     * chega a olhar a razao de negativa. Sem este caso, um `some()` mal
     * colocado poderia negar quem tem direito valido.
     */
    const resultado = evaluateAccess(
      entrada({
        entitlements: [entitlement({ status: 'SUSPENDED' }), entitlement({ status: 'ACTIVE' })],
      }),
    );

    expect(resultado).toMatchObject({ outcome: 'ALLOW', reason: 'ACTIVE_ENTITLEMENT' });
  });

  it('aluno BLOCKED continua BLOCKED mesmo devendo -- a ordem das regras nao muda', () => {
    /**
     * `PAYMENT_OVERDUE` entra no passo 4 do motor, depois de bloqueio
     * administrativo e situacao do aluno. Inadimplencia nao pode mascarar uma
     * decisao deliberada sobre a pessoa (`M1-BR-006`).
     */
    const resultado = evaluateAccess(
      entrada({
        student: { status: 'BLOCKED' },
        entitlements: [entitlement({ status: 'SUSPENDED' })],
      }),
    );

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'STUDENT_BLOCKED' });
  });

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

/**
 * OS SETE DIAS, ponta a ponta -- #129.
 *
 * O defeito que este bloco existe para impedir: quem gravava a janela usava
 * ISO-8601 (`1 = segunda ... 7 = domingo`) e quem decide le `Date.getDay()`
 * (`0 = domingo ... 6 = sabado`). De segunda a sabado os eixos coincidem, e
 * a suite inteira passava. So o DOMINGO divergia -- e negava todo aluno
 * cadastrado pelo caminho normal da API, com `OUTSIDE_SCHEDULE`.
 *
 * O teste roda `resolverHoraLocal` de verdade em vez de fixar
 * `localDayOfWeek` na mao, porque a mao e exatamente onde o eixo errado se
 * esconde: fixar o numero testaria o motor contra a suposicao do autor do
 * teste, e nao contra o que o relogio produz. Sete datas reais, uma por dia
 * da semana, convertidas pelo mesmo caminho da producao.
 */
describe('evaluateAccess -- eixo de dayOfWeek nos sete dias (#129)', () => {
  // Semana de 16 a 22/08/2026: domingo a sabado. 15:00Z = 12:00 em Sao Paulo.
  const SEMANA = [
    { rotulo: 'domingo', instante: '2026-08-16T15:00:00.000Z', esperado: 0 },
    { rotulo: 'segunda', instante: '2026-08-17T15:00:00.000Z', esperado: 1 },
    { rotulo: 'terca', instante: '2026-08-18T15:00:00.000Z', esperado: 2 },
    { rotulo: 'quarta', instante: '2026-08-19T15:00:00.000Z', esperado: 3 },
    { rotulo: 'quinta', instante: '2026-08-20T15:00:00.000Z', esperado: 4 },
    { rotulo: 'sexta', instante: '2026-08-21T15:00:00.000Z', esperado: 5 },
    { rotulo: 'sabado', instante: '2026-08-22T15:00:00.000Z', esperado: 6 },
  ] as const;

  it.each(SEMANA)(
    'libera $rotulo quando a janela do dia esta gravada no eixo do motor',
    ({ instante, esperado }) => {
      const local = resolverHoraLocal(instante, 'America/Sao_Paulo');

      // O elo que ninguem testava junto: o dia que o relogio produz tem de
      // ser o mesmo numero que a janela gravada carrega.
      expect(local.dayOfWeek).toBe(esperado);

      const janelaDoDia: AccessWindow = {
        dayOfWeek: esperado,
        startMinute: 6 * 60,
        endMinute: 22 * 60,
      };

      const resultado = evaluateAccess(
        entrada({
          evaluatedAt: instante,
          localDayOfWeek: local.dayOfWeek,
          localMinuteOfDay: local.minuteOfDay,
          entitlements: [entitlement({ windows: [janelaDoDia] })],
        }),
      );

      expect(resultado).toMatchObject({ outcome: 'ALLOW', reason: 'ACTIVE_ENTITLEMENT' });
    },
  );

  /**
   * A REGRESSAO EXATA, escrita como o defeito acontecia: janela de domingo
   * gravada no eixo ISO (`7`), avaliada num domingo real. Antes da correcao
   * isto era o comportamento de producao para toda a base.
   */
  it('nega domingo quando a janela foi gravada em ISO (7) -- o defeito do #129', () => {
    const local = resolverHoraLocal('2026-08-16T15:00:00.000Z', 'America/Sao_Paulo');

    const resultado = evaluateAccess(
      entrada({
        evaluatedAt: '2026-08-16T15:00:00.000Z',
        localDayOfWeek: local.dayOfWeek,
        localMinuteOfDay: local.minuteOfDay,
        entitlements: [
          entitlement({ windows: [{ dayOfWeek: 7, startMinute: 6 * 60, endMinute: 22 * 60 }] }),
        ],
      }),
    );

    expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'OUTSIDE_SCHEDULE' });
  });
});

describe('F65 (ADR-053) -- gate do contratante', () => {
  it('nega aluno perfeitamente regular quando o gate esta ativo', () => {
    const resultado = evaluateAccess(entrada({ tenant: { gateActive: true } }));

    expect(resultado).toEqual({
      outcome: 'DENY',
      reason: 'TENANT_SUSPENDED',
      policyVersion: POLICY_VERSION,
    });
  });

  it('o gate PRECEDE o bloqueio administrativo', () => {
    // Os dois ativos ao mesmo tempo. Se a ordem inverter, a recepcao le
    // "bloqueio administrativo" e vai mexer no cadastro do aluno -- quando o
    // que ha e a academia suspensa, que so o dono resolve pagando.
    const resultado = evaluateAccess(
      entrada({ tenant: { gateActive: true }, adminBlock: { active: true } }),
    );

    expect(resultado.reason).toBe('TENANT_SUSPENDED');
  });

  it('o gate PRECEDE o estado do aluno', () => {
    const resultado = evaluateAccess(
      entrada({ tenant: { gateActive: true }, student: { status: 'BLOCKED' } }),
    );

    expect(resultado.reason).toBe('TENANT_SUSPENDED');
  });

  it('levantado o gate, a MESMA entrada volta a permitir', () => {
    // A reversibilidade e o coracao do ADR-053 §2: o gate nao revoga nada,
    // entao a mesma entrada com o gate baixo tem de devolver ALLOW sem que
    // ninguem seja recadastrado.
    const comGate = evaluateAccess(entrada({ tenant: { gateActive: true } }));
    const semGate = evaluateAccess(entrada({ tenant: { gateActive: false } }));

    expect(comGate.outcome).toBe('DENY');
    expect(semGate.outcome).toBe('ALLOW');
  });
});
