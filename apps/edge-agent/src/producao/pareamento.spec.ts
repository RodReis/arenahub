import { describe, expect, it, jest } from '@jest/globals';

import { ArmazenamentoDeCredencialEmMemoria } from './armazenamento-de-credencial.js';
import { parear } from './pareamento.js';

describe('parear', () => {
  it('troca o codigo por credencial e salva no armazenamento', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    const trocarPorHttp = jest.fn(() =>
      Promise.resolve({ ok: true as const, keyId: 'key-1', secret: 'segredo-1' }),
    );

    const resultado = await parear({
      cloudApiUrl: 'https://nuvem.teste',
      codigo: 'codigo-123',
      armazenamento,
      trocarPorHttp,
    });

    expect(resultado).toEqual({ keyId: 'key-1', secret: 'segredo-1' });
    await expect(armazenamento.carregar()).resolves.toEqual({ keyId: 'key-1', secret: 'segredo-1' });
  });

  it('devolve null quando a nuvem recusa o codigo, sem salvar nada', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    const trocarPorHttp = jest.fn(() => Promise.resolve({ ok: false as const }));

    const resultado = await parear({
      cloudApiUrl: 'https://nuvem.teste',
      codigo: 'codigo-errado',
      armazenamento,
      trocarPorHttp,
    });

    expect(resultado).toBeNull();
    await expect(armazenamento.carregar()).resolves.toBeNull();
  });

  it('se ja existe credencial salva, nao troca de novo -- devolve a existente', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await armazenamento.salvar('key-existente', 'segredo-existente');
    const trocarPorHttp = jest.fn(() => Promise.resolve({ ok: false as const }));

    const resultado = await parear({
      cloudApiUrl: 'https://nuvem.teste',
      codigo: 'codigo-123',
      armazenamento,
      trocarPorHttp,
    });

    expect(resultado).toEqual({ keyId: 'key-existente', secret: 'segredo-existente' });
    expect(trocarPorHttp).not.toHaveBeenCalled();
  });
});
