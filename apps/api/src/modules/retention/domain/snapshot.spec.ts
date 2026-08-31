import { createHash } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import {
  montarSnapshot,
  reproduz,
  serializarCanonicamente,
  type IdentidadeDeSnapshot,
} from './snapshot.js';
import { ausente, observado } from './valor-de-feature.js';

const digest = (texto: string): string => createHash('sha256').update(texto).digest('hex');

const IDENTIDADE: IdentidadeDeSnapshot = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  studentId: '22222222-2222-2222-2222-222222222222',
  versaoDeAlvo: 'alvo@1',
  versaoDeFeatures: 'features@1',
  observadoEm: new Date('2026-08-31T00:00:00.000Z'),
  corteDeConhecimento: new Date('2026-08-31T00:00:00.000Z'),
};

describe('serializarCanonicamente', () => {
  it('nao depende da ordem em que as features foram calculadas', () => {
    /*
     * Sem a ordenacao, trocar a ordem das chamadas "mudaria" o snapshot e o
     * alarme de nao-determinismo dispararia pelo motivo errado.
     */
    const ordemA = [observado('b', 1), observado('a', 2)];
    const ordemB = [observado('a', 2), observado('b', 1)];

    expect(serializarCanonicamente(IDENTIDADE, ordemA)).toBe(
      serializarCanonicamente(IDENTIDADE, ordemB),
    );
  });

  it('distingue zero observado de ausente', () => {
    // A distincao de `M6-BR-002` levada ate o checksum.
    const zero = serializarCanonicamente(IDENTIDADE, [observado('a', 0)]);
    const semDado = serializarCanonicamente(IDENTIDADE, [ausente('a', 'SEM_HISTORICO')]);

    expect(zero).not.toBe(semDado);
  });

  it('distingue razoes de ausencia diferentes', () => {
    const semHistorico = serializarCanonicamente(IDENTIDADE, [ausente('a', 'SEM_HISTORICO')]);
    const suprimida = serializarCanonicamente(IDENTIDADE, [ausente('a', 'SUPRIMIDA')]);

    expect(semHistorico).not.toBe(suprimida);
  });

  it('distingue procedencias diferentes', () => {
    const asOf = serializarCanonicamente(IDENTIDADE, [observado('a', 1)]);
    const corrente = serializarCanonicamente(IDENTIDADE, [observado('a', 1, 'ESTADO_CORRENTE')]);

    expect(asOf).not.toBe(corrente);
  });

  it('muda quando o corte de conhecimento muda', () => {
    const outroCorte = {
      ...IDENTIDADE,
      corteDeConhecimento: new Date('2026-09-05T00:00:00.000Z'),
    };

    expect(serializarCanonicamente(IDENTIDADE, [observado('a', 1)])).not.toBe(
      serializarCanonicamente(outroCorte, [observado('a', 1)]),
    );
  });

  it('isola tenants com os mesmos valores', () => {
    // Regra de arquitetura no 2: dois tenants nunca colidem no mesmo checksum.
    const outroTenant = { ...IDENTIDADE, tenantId: '33333333-3333-3333-3333-333333333333' };

    expect(serializarCanonicamente(IDENTIDADE, [observado('a', 1)])).not.toBe(
      serializarCanonicamente(outroTenant, [observado('a', 1)]),
    );
  });
});

describe('montarSnapshot', () => {
  it('reproduz o mesmo checksum para o mesmo recorte', () => {
    // O aceite da Slice 6.1, verificavel.
    const valores = [observado('attendance_days_30d', 4), ausente('days_past_due', 'SEM_HISTORICO')];

    const primeiro = montarSnapshot(IDENTIDADE, valores, digest);
    const segundo = montarSnapshot(IDENTIDADE, [...valores].reverse(), digest);

    expect(reproduz(primeiro, segundo)).toBe(true);
  });

  it('acusa divergencia quando um valor muda', () => {
    const original = montarSnapshot(IDENTIDADE, [observado('a', 1)], digest);
    const alterado = montarSnapshot(IDENTIDADE, [observado('a', 2)], digest);

    expect(reproduz(original, alterado)).toBe(false);
  });

  it('deriva a completude em vez de recebe-la', () => {
    const snapshot = montarSnapshot(
      IDENTIDADE,
      [observado('a', 1), ausente('b', 'SEM_HISTORICO')],
      digest,
    );

    expect(snapshot.completude).toBe(0.5);
  });
});
