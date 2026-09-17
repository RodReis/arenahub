import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { resolverCredencial } from './resolver-credencial.js';
import { ArmazenamentoDeCredencialEmMemoria } from './armazenamento-de-credencial.js';

describe('resolverCredencial', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('usa env quando presente, sem tocar armazenamento', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();

    const resultado = await resolverCredencial({
      cloudApiUrl: undefined,
      keyIdDoEnv: 'key-env',
      secretDoEnv: 'secret-env',
      codigoDePareamento: undefined,
      armazenamento,
    });

    expect(resultado).toEqual({ keyId: 'key-env', secret: 'secret-env' });
  });

  it('usa o armazenamento quando env ausente', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await armazenamento.salvar('key-salva', 'secret-salva');

    const resultado = await resolverCredencial({
      cloudApiUrl: undefined,
      keyIdDoEnv: undefined,
      secretDoEnv: undefined,
      codigoDePareamento: undefined,
      armazenamento,
    });

    expect(resultado).toEqual({ keyId: 'key-salva', secret: 'secret-salva' });
  });

  it('devolve null quando nao ha env, nem armazenamento, nem codigo', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();

    const resultado = await resolverCredencial({
      cloudApiUrl: undefined,
      keyIdDoEnv: undefined,
      secretDoEnv: undefined,
      codigoDePareamento: undefined,
      armazenamento,
    });

    expect(resultado).toBeNull();
  });

  it('pareia via codigo quando ha url e codigo, mas nada salvo', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();

    // Mocka fetch (nao o modulo `parear`, que sob ESM/jest nao aceita
    // spyOn em export read-only) para provar que resolverCredencial
    // aciona o caminho de pareamento real -- sem depender de rede.
    const fetchEspiado = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ keyId: 'key-pareada', secret: 'secret-pareada' }), {
        status: 200,
      }),
    );

    const resultado = await resolverCredencial({
      cloudApiUrl: 'https://cloud.local',
      keyIdDoEnv: undefined,
      secretDoEnv: undefined,
      codigoDePareamento: 'codigo-valido',
      armazenamento,
    });

    expect(fetchEspiado).toHaveBeenCalledWith(
      'https://cloud.local/api/v1/edge/pair',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(resultado).toEqual({ keyId: 'key-pareada', secret: 'secret-pareada' });
    await expect(armazenamento.carregar()).resolves.toEqual({
      keyId: 'key-pareada',
      secret: 'secret-pareada',
    });
  });
});
