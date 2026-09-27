import { describe, expect, it, jest } from '@jest/globals';

import { GymUnitController } from './gym-unit.controller.js';

describe('GymUnitController — capacidadeMaxima', () => {
  it('rejeita capacidadeMaxima zero ou negativa na atualização', async () => {
    const repositorioFake = { atualizar: jest.fn() } as never;
    const contextoFake = { require: () => ({ tenantId: 'x', actorId: 'y' }) } as never;
    const controller = new GymUnitController(repositorioFake, contextoFake);

    await expect(
      controller.atualizar('id-qualquer', { capacidadeMaxima: 0 }, { correlationId: 'c1' } as never),
    ).rejects.toThrow();
  });
});
