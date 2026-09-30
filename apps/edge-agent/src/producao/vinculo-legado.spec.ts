import { describe, expect, it, jest } from '@jest/globals';
import pino from 'pino';

import type { SignedCloudClient } from '../cloud/signed-client.js';
import type { FacialDeviceAdapter, IdentidadeNoDispositivo } from '../domain/facial-device.js';
import { ligarVinculoLegado, TAMANHO_DO_LOTE } from './vinculo-legado.js';

/**
 * #468 -- a base do leitor vai para a nuvem vincular os alunos legados.
 *
 * O leitor da Arena Positiva so reenviou `senduser` na PRIMEIRA conexao (424)
 * e nenhum depois: o que ja foi confirmado nao volta. Por isso a base sai de
 * uma LISTAGEM no registro, e o `senduser` cobre so o cadastro novo feito
 * direto no leitor.
 */

const RESPOSTA = {
  refusedOrRevoked: [],
  linked: 1,
  alreadyLinked: 0,
  withoutStudent: [],
  ambiguous: [],
  studentAlreadyLinked: [],
  withoutConsentDocument: [],
};

function montar(base: readonly string[] = []) {
  let aoRegistrar: ((serial: string) => void) | undefined;
  let aoInformar: ((c: { serial: string; externalUserId: string }) => void) | undefined;

  const listar = jest.fn(
    (): Promise<IdentidadeNoDispositivo[]> =>
      Promise.resolve(base.map((externalEnrollId) => ({ externalEnrollId, rotulo: '' }))),
  );

  const facial = {
    nome: 'facial-falso',
    listar,
    aoRegistrar: (o: (serial: string) => void) => {
      aoRegistrar = o;
    },
    aoInformarCadastro: (o: (c: { serial: string; externalUserId: string }) => void) => {
      aoInformar = o;
    },
  } as unknown as FacialDeviceAdapter;

  const post = jest.fn(() => Promise.resolve({ ok: true, status: 201, body: RESPOSTA, errorCode: null }));
  const cliente = { post, get: jest.fn() } as unknown as SignedCloudClient;

  const linhas: Record<string, unknown>[] = [];
  const logger = pino(
    { level: 'info' },
    { write: (l: string) => linhas.push(JSON.parse(l) as Record<string, unknown>) },
  );

  const ligado = ligarVinculoLegado({ facial, cliente, logger, janelaMs: 20 });

  return {
    listar,
    post,
    linhas,
    ligado,
    registrar: (serial: string) => aoRegistrar?.(serial),
    informar: (serial: string, externalUserId: string) => aoInformar?.({ serial, externalUserId }),
  };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ligarVinculoLegado', () => {
  it('no registro, lista a base do leitor e manda os numeros com o serial', async () => {
    const { post, registrar, ligado } = montar(['1491', '2002']);

    registrar('AYTI11108174');
    await esperar(20);

    expect(post).toHaveBeenCalledWith('/api/v1/edge/device-users/legacy-links', {
      deviceSerial: 'AYTI11108174',
      externalUserIds: ['1491', '2002'],
    });

    ligado.encerrar();
  });

  it('fatia base maior que o teto da API', async () => {
    const base = Array.from({ length: TAMANHO_DO_LOTE + 5 }, (_, i) => String(i + 1));
    const { post, registrar, ligado } = montar(base);

    registrar('AYTI11108174');
    await esperar(30);

    expect(post).toHaveBeenCalledTimes(2);

    ligado.encerrar();
  });

  it('junta a rajada de senduser numa chamada so', async () => {
    const { post, informar, ligado } = montar();

    informar('AYTI11108174', '10');
    informar('AYTI11108174', '11');
    informar('AYTI11108174', '10');
    await esperar(60);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/v1/edge/device-users/legacy-links', {
      deviceSerial: 'AYTI11108174',
      externalUserIds: ['10', '11'],
    });

    ligado.encerrar();
  });

  it('registra em log o resultado do vinculo, com os pendentes', async () => {
    const { linhas, registrar, ligado } = montar(['1491']);

    registrar('AYTI11108174');
    await esperar(20);

    expect(linhas).toContainEqual(
      expect.objectContaining({ msg: 'base do leitor vinculada', leitor: 'AYTI11108174', vinculados: 1 }),
    );

    ligado.encerrar();
  });

  it('lista a base UMA vez por leitor -- listar pausa o leitor', async () => {
    // `listar` manda `disabledevice`: a cada reconexao, o leitor ficaria
    // segundos sem reconhecer ninguem. A base nao muda por reconectar.
    const { listar, registrar, ligado } = montar(['1491']);

    registrar('AYTI11108174');
    await esperar(20);
    registrar('AYTI11108174');
    await esperar(20);

    expect(listar).toHaveBeenCalledTimes(1);

    ligado.encerrar();
  });

  it('manda um lote por vez -- chamadas simultaneas disputariam o mesmo vinculo', async () => {
    const { post, registrar, informar, ligado } = montar(['1491']);
    let emVoo = 0;
    let maximo = 0;
    post.mockImplementation(async () => {
      emVoo += 1;
      maximo = Math.max(maximo, emVoo);
      await esperar(30);
      emVoo -= 1;
      return { ok: true, status: 201, body: RESPOSTA, errorCode: null };
    });

    registrar('AYTI11108174');
    informar('AYTI11108174', '1491');
    await esperar(150);

    expect(post).toHaveBeenCalledTimes(2);
    expect(maximo).toBe(1);

    ligado.encerrar();
  });

  it('manda o lote de senduser assim que enche, sem esperar a janela', async () => {
    const { post, informar, ligado } = montar();

    for (let i = 0; i < TAMANHO_DO_LOTE; i += 1) informar('AYTI11108174', String(i));
    await esperar(5);

    expect(post).toHaveBeenCalledTimes(1);

    ligado.encerrar();
  });

  it('falha ao listar vira aviso, nao derruba o agente', async () => {
    const { listar, linhas, registrar, ligado } = montar();
    listar.mockImplementation(() => Promise.reject(new Error('sem resposta')));

    registrar('AYTI11108174');
    await esperar(20);

    expect(linhas).toContainEqual(
      expect.objectContaining({ msg: 'nao foi possivel listar a base do leitor' }),
    );

    ligado.encerrar();
  });
});
