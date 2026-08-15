import { describe, expect, it } from '@jest/globals';

import {
  TopdataInnerAdapter,
  TopdataInnerAdapterNaoImplementadoError,
} from './topdata-inner-adapter.js';

describe('TopdataInnerAdapter — nao implementado', () => {
  const adapter = new TopdataInnerAdapter();

  // Este adapter MOVE UMA CATRACA. Falhar alto importa mais aqui do que no
  // adapter facial: um comando parcialmente funcional -- abre mas nao
  // confirma, ou abre duas vezes -- produz efeito fisico num equipamento
  // instalado e em uso.

  it('liberar lanca, nunca finge que comandou', () => {
    expect(() => void adapter.liberar('cmd-1', 8000)).toThrow(
      TopdataInnerAdapterNaoImplementadoError,
    );
  });

  it('a mensagem diz por que nao esta implementado', () => {
    expect(() => void adapter.liberar('cmd-1', 8000)).toThrow(/catraca fisica instalada/);
  });

  it('a mensagem aponta o caminho suportado', () => {
    expect(() => void adapter.liberar('cmd-1', 8000)).toThrow(/USE_SIMULATOR=true/);
  });

  it('encerrar NAO lanca — shutdown gracioso nao pode explodir', async () => {
    await expect(adapter.encerrar()).resolves.toBeUndefined();
  });
});
