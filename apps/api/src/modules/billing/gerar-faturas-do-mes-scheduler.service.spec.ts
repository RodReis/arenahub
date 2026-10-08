import { describe, expect, it, jest } from '@jest/globals';

import { GerarFaturasDoMesSchedulerService } from './gerar-faturas-do-mes-scheduler.service.js';

/**
 * F89 -- o job roda todo dia e cada tenant decide se hoje e o seu dia de gerar.
 * Sem banco: repositorio e use case sao falsos; `comContexto` so abre um
 * AsyncLocalStorage (exige uuid valido).
 */
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const TENANT_C = '33333333-3333-4333-8333-333333333333';

const RESULTADO = { elegiveis: 3, criadas: 2, jaExistiam: 1, falhas: 0 };

function montar(dias: Record<string, number>) {
  const repositorio = {
    listarTenantsAtivos: jest.fn<() => Promise<string[]>>().mockResolvedValue(Object.keys(dias)),
    diaDeGerarFaturas: jest
      .fn<(tenantId: string) => Promise<number>>()
      .mockImplementation((tenantId) => Promise.resolve(dias[tenantId] ?? 1)),
  };
  const executar = jest
    .fn<(tenantId: string, agora: Date) => Promise<typeof RESULTADO>>()
    .mockResolvedValue(RESULTADO);
  const scheduler = new GerarFaturasDoMesSchedulerService(repositorio as never, { executar } as never);

  return { scheduler, executar };
}

describe('GerarFaturasDoMesSchedulerService -- dia de gerar por tenant', () => {
  it('gera so nos tenants cujo dia de gerar e hoje', async () => {
    const { scheduler, executar } = montar({ [TENANT_A]: 5, [TENANT_B]: 1 });
    const agora = new Date('2026-11-05T12:00:00Z');

    const r = await scheduler.executarCiclo(agora);

    expect(executar).toHaveBeenCalledTimes(1);
    expect(executar).toHaveBeenCalledWith(TENANT_A, agora);
    expect(r).toEqual({ tenants: 2, foraDoDia: 1, ...RESULTADO });
  });

  it('tenant com dia 1 (padrao) gera no dia 01 e nao no dia 02', async () => {
    const { scheduler, executar } = montar({ [TENANT_A]: 1 });

    const dia1 = await scheduler.executarCiclo(new Date('2026-12-01T12:00:00Z'));
    const dia2 = await scheduler.executarCiclo(new Date('2026-12-02T12:00:00Z'));

    expect(executar).toHaveBeenCalledTimes(1);
    expect(dia1.foraDoDia).toBe(0);
    expect(dia2).toEqual({
      tenants: 1,
      foraDoDia: 1,
      elegiveis: 0,
      criadas: 0,
      jaExistiam: 0,
      falhas: 0,
    });
  });

  it('o dia e o de Brasilia, nao o UTC: 01/11 02:30Z ainda e 31/10', async () => {
    const { scheduler, executar } = montar({ [TENANT_A]: 1 });

    const r = await scheduler.executarCiclo(new Date('2026-11-01T02:30:00Z'));

    expect(executar).not.toHaveBeenCalled();
    expect(r.foraDoDia).toBe(1);
  });

  it('falha em um tenant nao impede os outros', async () => {
    const { scheduler, executar } = montar({ [TENANT_A]: 1, [TENANT_B]: 1, [TENANT_C]: 5 });
    executar.mockRejectedValueOnce(new Error('boom'));
    jest.spyOn(scheduler['log'], 'error').mockImplementation(() => undefined);

    const r = await scheduler.executarCiclo(new Date('2026-12-01T12:00:00Z'));

    expect(executar).toHaveBeenCalledTimes(2);
    expect(r).toEqual({
      tenants: 3,
      foraDoDia: 1,
      elegiveis: 3,
      criadas: 2,
      jaExistiam: 1,
      falhas: 1,
    });
  });
});
