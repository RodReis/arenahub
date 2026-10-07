import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { AplicarInadimplenciaSchedulerService } from './aplicar-inadimplencia-scheduler.service.js';

/**
 * O job de bloqueio por inadimplencia nasce DESLIGADO (F88): so roda com
 * `BILLING_DELINQUENCY_JOB_ENABLED` exatamente igual a 'true'. A comparacao e
 * estrita de proposito -- '1' e 'TRUE' nao ligam, e o teste existe para que
 * ninguem "afrouxe" isso sem perceber que passou a bloquear alunos de producao.
 */
describe('AplicarInadimplenciaSchedulerService -- portao da env', () => {
  const NOME_DA_ENV = 'BILLING_DELINQUENCY_JOB_ENABLED';
  const original = process.env[NOME_DA_ENV];

  let scheduler: AplicarInadimplenciaSchedulerService;
  let executarCiclo: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    scheduler = new AplicarInadimplenciaSchedulerService({} as never, {} as never);
    executarCiclo = jest
      .spyOn(scheduler, 'executarCiclo')
      .mockResolvedValue({ tenants: 0, direitosSuspensos: 0, falhas: 0 });
  });

  afterEach(() => {
    if (original === undefined) delete process.env[NOME_DA_ENV];
    else process.env[NOME_DA_ENV] = original;

    jest.restoreAllMocks();
  });

  it.each([
    ['ausente', undefined],
    ['"1"', '1'],
    ['"TRUE"', 'TRUE'],
    ['"false"', 'false'],
    ['vazia', ''],
  ])('nao roda o ciclo com a env %s', async (_rotulo, valor) => {
    if (valor === undefined) delete process.env[NOME_DA_ENV];
    else process.env[NOME_DA_ENV] = valor;

    await scheduler.executarComTrava();

    expect(executarCiclo).not.toHaveBeenCalled();
  });

  it('roda o ciclo com a env "true"', async () => {
    process.env[NOME_DA_ENV] = 'true';

    await scheduler.executarComTrava();

    expect(executarCiclo).toHaveBeenCalledTimes(1);
  });
});
