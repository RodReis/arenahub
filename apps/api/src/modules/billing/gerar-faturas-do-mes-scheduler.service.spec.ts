import { describe, expect, it, jest } from '@jest/globals';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants.js';

import { FUSO_DOS_AGENDADORES } from './domain/configuracao-de-pagamento.js';
import { GerarFaturasDoMesSchedulerService } from './gerar-faturas-do-mes-scheduler.service.js';

/**
 * F89 -- o job roda todo dia e cada tenant gera a partir do seu dia de gerar.
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
  it('gera nos tenants cujo dia de gerar chegou e pula os de dia posterior', async () => {
    const { scheduler, executar } = montar({ [TENANT_A]: 5, [TENANT_B]: 10 });
    const agora = new Date('2026-11-05T12:00:00Z');

    const r = await scheduler.executarCiclo(agora);

    expect(executar).toHaveBeenCalledTimes(1);
    expect(executar).toHaveBeenCalledWith(TENANT_A, agora);
    expect(r).toEqual({ tenants: 2, foraDoDia: 1, ...RESULTADO });
  });

  it('tenant com dia 1 (padrao) gera no dia 01 e continua gerando nos dias seguintes', async () => {
    const { scheduler, executar } = montar({ [TENANT_A]: 1 });

    const dia1 = await scheduler.executarCiclo(new Date('2026-12-01T12:00:00Z'));
    const dia2 = await scheduler.executarCiclo(new Date('2026-12-02T12:00:00Z'));

    expect(executar).toHaveBeenCalledTimes(2);
    expect(dia1.foraDoDia).toBe(0);
    expect(dia2.foraDoDia).toBe(0);
  });

  it('dia que ainda nao chegou nao gera: dia 10 em 05/11', async () => {
    const { scheduler, executar } = montar({ [TENANT_A]: 10 });

    const r = await scheduler.executarCiclo(new Date('2026-11-05T12:00:00Z'));

    expect(executar).not.toHaveBeenCalled();
    expect(r).toEqual({
      tenants: 1,
      foraDoDia: 1,
      elegiveis: 0,
      criadas: 0,
      jaExistiam: 0,
      falhas: 0,
    });
  });

  it('dia trocado de 20 para 5 em 10/11: o mes nao fica sem fatura', async () => {
    const { scheduler, executar } = montar({ [TENANT_A]: 5 });
    const agora = new Date('2026-11-10T12:00:00Z');

    const r = await scheduler.executarCiclo(agora);

    expect(executar).toHaveBeenCalledWith(TENANT_A, agora);
    expect(r.foraDoDia).toBe(0);
  });

  it('o dia e o de Brasilia, nao o UTC: 04/11 02:59Z ainda e 03/11', async () => {
    const { scheduler, executar } = montar({ [TENANT_A]: 4 });

    const r = await scheduler.executarCiclo(new Date('2026-11-04T02:59:00Z'));

    expect(executar).not.toHaveBeenCalled();
    expect(r.foraDoDia).toBe(1);
  });

  it('tenant fora do dia no comeco da lista nao impede o seguinte de gerar', async () => {
    const { scheduler, executar } = montar({ [TENANT_A]: 20, [TENANT_B]: 5 });
    const agora = new Date('2026-11-10T12:00:00Z');

    const r = await scheduler.executarCiclo(agora);

    expect(executar).toHaveBeenCalledTimes(1);
    expect(executar).toHaveBeenCalledWith(TENANT_B, agora);
    expect(r).toEqual({ tenants: 2, foraDoDia: 1, ...RESULTADO });
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

describe('GerarFaturasDoMesSchedulerService -- agendamento', () => {
  // Sem isto, deixar a expressao mensal antiga ('5 0 1 * *') passaria em todo
  // teste e a F89 viraria no-op em producao fora do dia 01.
  it('o @Cron roda todo dia as 00:05 de Brasilia', () => {
    const metodo: unknown = Reflect.get(GerarFaturasDoMesSchedulerService.prototype, 'executarComTrava');
    const opcoes: unknown = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, metodo as object);

    expect(opcoes).toMatchObject({
      cronTime: '5 0 * * *',
      timeZone: FUSO_DOS_AGENDADORES,
      name: 'gerar-faturas-do-mes',
    });
    expect(FUSO_DOS_AGENDADORES).toBe('America/Sao_Paulo');
  });
});
