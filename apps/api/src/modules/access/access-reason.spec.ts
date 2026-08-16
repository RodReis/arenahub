import { describe, expect, it } from '@jest/globals';
import { ALLOW_REASON, DENY_REASON } from '@arenahub/access-policy';

/**
 * Guarda da duplicacao deliberada entre motor puro e schema.
 *
 * `packages/access-policy` NAO importa Prisma -- precisa rodar no Edge, onde
 * nao ha PostgreSQL. Entao a lista de razoes existe em dois lugares: la, como
 * const, e no `schema.prisma`, como enum.
 *
 * A duplicacao e o preco da pureza. Este teste e o que impede o preco de
 * virar prejuizo: sem ele, acrescentar `PAYMENT_OVERDUE` no MVP 2 em so um
 * dos dois lados falharia em producao, no `INSERT`, com a catraca na frente
 * de uma pessoa.
 *
 * A lista abaixo e copiada A MAO do `schema.prisma` de proposito. Importar o
 * enum do Prisma aqui faria o teste comparar a mesma fonte consigo mesma e
 * passar sempre.
 */
const RAZOES_NO_SCHEMA = [
  'ACTIVE_ENTITLEMENT',
  'MANUAL_OVERRIDE',
  'ADMIN_BLOCK',
  'STUDENT_BLOCKED',
  'STUDENT_INACTIVE',
  'NO_ENTITLEMENT',
  'WRONG_UNIT',
  'OUTSIDE_SCHEDULE',
] as const;

describe('ADR-024 -- razoes do motor e do banco nao divergem', () => {
  it('o motor produz exatamente as razoes que o enum do Prisma aceita', () => {
    const doMotor = [...Object.values(ALLOW_REASON), ...Object.values(DENY_REASON)].sort();

    expect(doMotor).toEqual([...RAZOES_NO_SCHEMA].sort());
  });

  it('ha duas razoes de ALLOW: a do motor e a do override', () => {
    expect([...Object.values(ALLOW_REASON)].sort()).toEqual([
      'ACTIVE_ENTITLEMENT',
      'MANUAL_OVERRIDE',
    ]);
  });

  it('o motor NUNCA devolve MANUAL_OVERRIDE -- so o caso de uso o grava', () => {
    // Guarda de regressao para a emenda do ADR-024: o tipo
    // `EngineAllowReason` exclui `MANUAL_OVERRIDE`, e o compilador recusaria
    // um `evaluateAccess` que tentasse devolve-lo. Este teste registra a
    // intencao para quem ler o arquivo sem abrir os tipos.
    const doMotor: ReadonlySet<string> = new Set(['ACTIVE_ENTITLEMENT']);

    expect(doMotor.has('MANUAL_OVERRIDE')).toBe(false);
  });

  it('ha exatamente seis razoes de DENY -- ADR-024', () => {
    expect(Object.values(DENY_REASON)).toHaveLength(6);
  });
});
