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

function montar(
  base: readonly string[] = [],
  janelaMs = 20,
  extra: {
    intervaloEntreTentativasMs?: number;
    agoraMs?: () => number;
    aposVincular?: (serial: string) => void;
  } = {},
) {
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

  // Intervalo zero por padrao: os testes de nova tentativa registram o leitor
  // em seguida, e o intervalo minimo de producao (60 s) os bloquearia.
  const ligado = ligarVinculoLegado({
    facial,
    cliente,
    logger,
    janelaMs,
    intervaloEntreTentativasMs: 0,
    ...extra,
  });

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

/**
 * Espera ATE a condicao valer, com teto. Janela fixa de 20 ms passava no
 * Windows e estourava no CI, com todos os pacotes testando em paralelo e a
 * CPU disputada.
 */
async function ate(condicao: () => boolean, tetoMs = 2_000): Promise<void> {
  const limite = Date.now() + tetoMs;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error('condicao nao ocorreu a tempo');
    await esperar(5);
  }
}

describe('ligarVinculoLegado', () => {
  it('no registro, lista a base do leitor e manda os numeros com o serial', async () => {
    const { post, registrar, ligado } = montar(['1491', '2002']);

    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length > 0);

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
    await ate(() => post.mock.calls.length >= 2);

    expect(post).toHaveBeenCalledTimes(2);

    ligado.encerrar();
  });

  it('junta a rajada de senduser numa chamada so', async () => {
    const { post, informar, ligado } = montar();

    informar('AYTI11108174', '10');
    informar('AYTI11108174', '11');
    informar('AYTI11108174', '10');
    await ate(() => post.mock.calls.length > 0);
    // Folga para um eventual segundo envio indevido aparecer.
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
    await ate(() => linhas.some((l) => l['msg'] === 'base do leitor vinculada'));

    expect(linhas).toContainEqual(
      expect.objectContaining({
        msg: 'base do leitor vinculada',
        leitor: 'AYTI11108174',
        prontosNaCatraca: 1,
        novos: 1,
      }),
    );

    ligado.encerrar();
  });

  /*
   * Arena Positiva, 01/10/2026: com lote de 50, a base virava nove linhas
   * longas no log. Uma linha so, com os totais de todos os lotes.
   */
  it('soma os lotes numa linha so de resultado', async () => {
    const base = Array.from({ length: TAMANHO_DO_LOTE + 5 }, (_, i) => String(i + 1));
    const { linhas, registrar, ligado } = montar(base);

    registrar('AYTI11108174');
    await ate(() => linhas.some((l) => l['msg'] === 'base do leitor vinculada'));

    const resultados = linhas.filter((l) => l['msg'] === 'base do leitor vinculada');
    expect(resultados).toHaveLength(1);
    // A resposta falsa diz `linked: 1` por chamada: duas chamadas, dois.
    expect(resultados[0]).toMatchObject({ numeros: TAMANHO_DO_LOTE + 5, prontosNaCatraca: 2 });

    ligado.encerrar();
  });

  it('lista a base UMA vez por leitor -- listar pausa o leitor', async () => {
    // `listar` manda `disabledevice`: a cada reconexao, o leitor ficaria
    // segundos sem reconhecer ninguem. A base nao muda por reconectar.
    const { listar, post, registrar, ligado } = montar(['1491']);

    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length > 0);
    registrar('AYTI11108174');
    await esperar(60);

    expect(listar).toHaveBeenCalledTimes(1);

    ligado.encerrar();
  });

  /*
   * #488 -- Arena Positiva, 01/10/2026. A nuvem respondeu 404 (leitor sem
   * Edge) e a base ficou marcada como feita: o vinculo so seria tentado de
   * novo no proximo reinicio do agente. Falha nao pode contar como feito.
   */
  it('se a nuvem recusar o vinculo, tenta de novo no proximo registro do leitor (#488)', async () => {
    const { listar, post, registrar, ligado } = montar(['1491']);
    // O mock nasce tipado pela resposta de sucesso; a falha tem corpo nulo.
    (post as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 404, body: null, errorCode: 'DEVICE_NOT_IN_SCOPE' }),
    );

    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length >= 1);
    // Deixa a falha ser processada antes do leitor se registrar de novo.
    await esperar(30);
    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length >= 2);

    expect(listar).toHaveBeenCalledTimes(2);

    ligado.encerrar();
  });

  /** #503 -- as fotos so sao pedidas DEPOIS que o vinculo chegou na nuvem. */
  it('avisa quem importa as fotos depois que a base chegou na nuvem (#503)', async () => {
    const aposVincular = jest.fn();
    const { post, registrar, ligado } = montar(['1491'], 20, { aposVincular });

    registrar('AYTI11108174');
    await ate(() => aposVincular.mock.calls.length === 1);

    expect(aposVincular).toHaveBeenCalledWith('AYTI11108174');
    expect(post).toHaveBeenCalledTimes(1);

    ligado.encerrar();
  });

  it('nao pede fotos quando o vinculo nao chegou na nuvem (#503)', async () => {
    const aposVincular = jest.fn();
    const { post, registrar, ligado } = montar(['1491'], 20, { aposVincular });
    (post as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 0, body: null, errorCode: null }),
    );

    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length >= 1);
    await esperar(30);

    expect(aposVincular).not.toHaveBeenCalled();

    ligado.encerrar();
  });

  it('se listar a base falhar, tenta de novo no proximo registro do leitor (#488)', async () => {
    const { listar, post, registrar, ligado } = montar(['1491']);
    listar.mockImplementationOnce(() => Promise.reject(new Error('sem resposta')));

    registrar('AYTI11108174');
    await ate(() => listar.mock.calls.length >= 1);
    await esperar(30);
    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length >= 1);

    expect(listar).toHaveBeenCalledTimes(2);

    ligado.encerrar();
  });

  /*
   * Revisao do #488: falha PERSISTENTE (leitor nao cadastrado no painel, por
   * exemplo) nao pode virar laco -- cada tentativa faz `listar`, que pausa o
   * leitor (`disabledevice`), e o leitor reconecta sozinho.
   */
  it('falha persistente nao refaz a listagem antes do intervalo minimo, e volta a tentar depois (#488)', async () => {
    let agora = 1_000_000;
    const { listar, post, registrar, ligado } = montar(['1491'], 20, {
      intervaloEntreTentativasMs: 60_000,
      agoraMs: () => agora,
    });
    (post as jest.Mock).mockImplementation(() =>
      Promise.resolve({ ok: false, status: 404, body: null, errorCode: 'DEVICE_NOT_IN_SCOPE' }),
    );

    registrar('AYTI11108174');
    await ate(() => post.mock.calls.length >= 1);
    await esperar(30);

    // O leitor reconecta 10 s depois: dentro do intervalo, nao lista de novo.
    agora += 10_000;
    registrar('AYTI11108174');
    await esperar(60);
    expect(listar).toHaveBeenCalledTimes(1);

    // Passado o intervalo, tenta de novo.
    agora += 61_000;
    registrar('AYTI11108174');
    await ate(() => listar.mock.calls.length >= 2);

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
    await ate(() => post.mock.calls.length >= 2 && emVoo === 0);

    expect(post).toHaveBeenCalledTimes(2);
    expect(maximo).toBe(1);

    ligado.encerrar();
  });

  it('manda o lote de senduser assim que enche, sem esperar a janela', async () => {
    // Janela de 10 s: se o envio esperasse a janela, o teste estouraria o teto.
    const { post, informar, ligado } = montar([], 10_000);

    for (let i = 0; i < TAMANHO_DO_LOTE; i += 1) informar('AYTI11108174', String(i));
    await ate(() => post.mock.calls.length > 0);

    expect(post).toHaveBeenCalledTimes(1);

    ligado.encerrar();
  });

  it('falha ao listar vira aviso, nao derruba o agente', async () => {
    const { listar, linhas, registrar, ligado } = montar();
    listar.mockImplementation(() => Promise.reject(new Error('sem resposta')));

    registrar('AYTI11108174');
    await ate(() => linhas.some((l) => l['msg'] === 'nao foi possivel listar a base do leitor'));

    expect(linhas).toContainEqual(
      expect.objectContaining({ msg: 'nao foi possivel listar a base do leitor' }),
    );

    ligado.encerrar();
  });
});
