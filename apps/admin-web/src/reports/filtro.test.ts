import { describe, expect, it } from 'vitest';

import { CHAVES_DO_FILTRO, consultaDoFiltro } from './filtro';

describe('consultaDoFiltro', () => {
  it('repassa só as chaves conhecidas e não vazias', () => {
    const valores: Record<string, string> = {
      gymUnitId: 'u1',
      status: 'ACTIVE',
      profile: '',
      planId: 'p1',
      financeiro: 'PAGANTES',
      tenantId: 'outro',
      format: 'pdf',
    };

    const consulta = consultaDoFiltro((chave) => valores[chave]);

    expect(Object.fromEntries(consulta)).toEqual({
      gymUnitId: 'u1',
      status: 'ACTIVE',
      planId: 'p1',
      financeiro: 'PAGANTES',
    });
  });

  it('nada informado = consulta vazia', () => {
    expect(consultaDoFiltro(() => undefined).toString()).toBe('');
  });

  it('as chaves são exatamente as cinco do relatório', () => {
    expect([...CHAVES_DO_FILTRO]).toEqual(['gymUnitId', 'status', 'profile', 'planId', 'financeiro']);
  });
});
