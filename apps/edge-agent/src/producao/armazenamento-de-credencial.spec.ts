import { describe, expect, it } from '@jest/globals';

import { ArmazenamentoDeCredencialEmMemoria } from './armazenamento-de-credencial.js';

describe('ArmazenamentoDeCredencialEmMemoria', () => {
  it('carrega null quando nada foi salvo', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await expect(armazenamento.carregar()).resolves.toBeNull();
  });

  it('salva e recupera a credencial', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await armazenamento.salvar('key-1', 'segredo-1');
    await expect(armazenamento.carregar()).resolves.toEqual({ keyId: 'key-1', secret: 'segredo-1' });
  });

  it('apagar remove a credencial', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await armazenamento.salvar('key-1', 'segredo-1');
    await armazenamento.apagar();
    await expect(armazenamento.carregar()).resolves.toBeNull();
  });
});
