import { describe, expect, it } from '@jest/globals';

import {
  TopdataAdapterNaoImplementadoError,
  TopdataFacialAdapter,
} from './topdata-facial-adapter.js';

describe('TopdataFacialAdapter — nao implementado', () => {
  const adapter = new TopdataFacialAdapter();

  // Falhar alto e COMPORTAMENTO, nao acidente. A alternativa -- devolver
  // { confirmado: false } silenciosamente -- seria pior: o chamador trataria
  // como "o dispositivo recusou" e seguiria, quando na verdade nao ha adapter
  // nenhum. Erro de programacao nao pode se disfarcar de erro de operacao.

  it('cadastrar lanca, nunca devolve falha silenciosa', () => {
    expect(() => adapter.cadastrar({ externalEnrollId: 'x', rotulo: 'y' })).toThrow(
      TopdataAdapterNaoImplementadoError,
    );
  });

  it('remover lanca', () => {
    expect(() => adapter.remover('x')).toThrow(TopdataAdapterNaoImplementadoError);
  });

  it('listar lanca', () => {
    expect(() => adapter.listar()).toThrow(TopdataAdapterNaoImplementadoError);
  });

  it('aoReconhecer lanca', () => {
    expect(() => adapter.aoReconhecer(() => undefined)).toThrow(
      TopdataAdapterNaoImplementadoError,
    );
  });

  it('a mensagem aponta o caminho suportado', () => {
    // `void` porque o metodo lanca de forma sincrona -- nao ha promise para
    // aguardar. Se um dia ele passar a rejeitar em vez de lancar, este teste
    // quebra, que e o aviso correto.
    expect(() => void adapter.listar()).toThrow(/USE_SIMULATOR=true/);
  });

  it('encerrar NAO lanca — shutdown gracioso nao pode explodir por isto', async () => {
    // M0-NFR-007: encerrar graciosamente. Fazer o shutdown falhar por causa
    // de um adapter que nunca abriu seria trocar um problema por outro pior.
    await expect(adapter.encerrar()).resolves.toBeUndefined();
  });
});
