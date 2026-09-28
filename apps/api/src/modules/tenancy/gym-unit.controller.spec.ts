import { describe, expect, it, jest } from '@jest/globals';
import { ZodError } from 'zod';

import { GymUnitController } from './gym-unit.controller.js';

/**
 * Captura o `ZodError` de uma chamada que deve rejeitar, e falha o teste se a
 * causa nao for a que se espera. `rejects.toThrow()` sozinho nao distingue
 * "rejeitado por chave desconhecida" (regra pre-existente do `.strict()`) de
 * "rejeitado pela validacao de valor" (regra desta task, `.positive()`) --
 * as duas produzem excecao, so o `code` do issue difere.
 */
async function capturarZodError(promessa: Promise<unknown>): Promise<ZodError> {
  try {
    await promessa;
  } catch (erro) {
    expect(erro).toBeInstanceOf(ZodError);
    return erro as ZodError;
  }

  throw new Error('Esperava que a promessa rejeitasse com ZodError, mas ela resolveu');
}

describe('GymUnitController — capacidadeMaxima', () => {
  it('rejeita capacidadeMaxima zero na atualização pela validacao .positive(), nao por chave desconhecida', async () => {
    const repositorioFake = { atualizar: jest.fn() } as never;
    const contextoFake = { require: () => ({ tenantId: 'x', actorId: 'y' }) } as never;
    const controller = new GymUnitController(repositorioFake, contextoFake);

    const erro = await capturarZodError(
      controller.atualizar('id-qualquer', { capacidadeMaxima: 0 }, { correlationId: 'c1' } as never),
    );

    expect(erro.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'too_small', path: ['capacidadeMaxima'] }),
      ]),
    );
    expect(erro.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(false);
  });

  it('rejeita capacidadeMaxima negativa na atualização pela validacao .positive()', async () => {
    const repositorioFake = { atualizar: jest.fn() } as never;
    const contextoFake = { require: () => ({ tenantId: 'x', actorId: 'y' }) } as never;
    const controller = new GymUnitController(repositorioFake, contextoFake);

    const erro = await capturarZodError(
      controller.atualizar('id-qualquer', { capacidadeMaxima: -5 }, { correlationId: 'c1' } as never),
    );

    expect(erro.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'too_small', path: ['capacidadeMaxima'] }),
      ]),
    );
  });

  it('rejeita capacidadeMaxima zero na criação pela validacao .positive(), nao por chave desconhecida', async () => {
    const repositorioFake = { criar: jest.fn() } as never;
    const contextoFake = { require: () => ({ tenantId: 'x', actorId: 'y' }) } as never;
    const controller = new GymUnitController(repositorioFake, contextoFake);

    const erro = await capturarZodError(
      controller.criar(
        {
          code: 'UN1',
          name: 'Unidade 1',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
          capacidadeMaxima: 0,
        },
        { correlationId: 'c1' } as never,
      ),
    );

    expect(erro.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'too_small', path: ['capacidadeMaxima'] }),
      ]),
    );
    expect(erro.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(false);
  });

  /**
   * `null` E ESTADO DE PRODUTO VALIDO na atualizacao: "sem limite definido".
   * Diferente de campo AUSENTE (que significa "nao mexer" no repositorio),
   * `null` explicito significa "esvazie". Sem `.nullable()` no schema, esta
   * chamada rejeitaria com ZodError antes mesmo de chegar no repositorio --
   * e e exatamente isso que este teste prova que NAO acontece mais.
   */
  it('aceita capacidadeMaxima null na atualizacao, sem rejeitar por tipo', async () => {
    const unidadeAtualizada = {
      id: 'id-qualquer',
      code: 'UN1',
      name: 'Unidade 1',
      timezone: 'America/Sao_Paulo',
      openingHours: {},
      status: 'ACTIVE',
      capacidadeMaxima: null,
    };
    const atualizarFake = jest.fn<() => Promise<typeof unidadeAtualizada>>();
    atualizarFake.mockResolvedValue(unidadeAtualizada);
    const repositorioFake = { atualizar: atualizarFake } as never;
    const contextoFake = { require: () => ({ tenantId: 'x', actorId: 'y' }) } as never;
    const controller = new GymUnitController(repositorioFake, contextoFake);

    const dto = await controller.atualizar(
      'id-qualquer',
      { capacidadeMaxima: null },
      { correlationId: 'c1' } as never,
    );

    expect(dto.capacidadeMaxima).toBeNull();
    expect(atualizarFake).toHaveBeenCalledWith(
      { tenantId: 'x', actorId: 'y' },
      'id-qualquer',
      expect.objectContaining({ capacidadeMaxima: null }),
      'c1',
      undefined,
    );
  });
});
