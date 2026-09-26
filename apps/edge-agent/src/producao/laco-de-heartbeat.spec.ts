import { describe, expect, it, jest } from '@jest/globals';
import { iniciarLacoDeHeartbeat } from './laco-de-heartbeat.js';
import type { SignedCloudClient } from '../cloud/signed-client.js';

describe('iniciarLacoDeHeartbeat', () => {
  it('envia heartbeat no intervalo configurado e para quando pedido', () => {
    jest.useFakeTimers();

    const post = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: { serverTime: new Date().toISOString(), clockOffsetMs: 0, acknowledgedDevices: 0 },
        errorCode: null,
      }),
    );

    const cliente = {
      post,
      get: jest.fn(),
    } as unknown as SignedCloudClient;

    const parar = iniciarLacoDeHeartbeat({
      cliente,
      montarCorpo: () => ({ agentVersion: '1.0.0', localTimeMs: Date.now(), queueDepth: 0, devices: [] }),
      intervaloMs: 30_000,
    });

    jest.advanceTimersByTime(30_000);

    expect(post).toHaveBeenCalledTimes(1);

    parar();
    jest.useRealTimers();
  });

  it('chama aoFalhar quando a nuvem nao responde, sem lancar', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });

    const cliente = {
      post: jest.fn(() => Promise.resolve({ ok: false, status: 0, body: null, errorCode: 'CLOUD_UNREACHABLE' })),
      get: jest.fn(),
    } as unknown as SignedCloudClient;

    const aoFalhar = jest.fn();

    const parar = iniciarLacoDeHeartbeat({
      cliente,
      montarCorpo: () => ({ agentVersion: '1.0.0', localTimeMs: Date.now(), queueDepth: 0, devices: [] }),
      intervaloMs: 1_000,
      aoFalhar,
    });

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(aoFalhar).toHaveBeenCalledWith('CLOUD_UNREACHABLE');

    parar();
    jest.useRealTimers();
  });

  /**
   * Issue #406, quinto elo -- Arena Positiva, 26/09/2026.
   *
   * O laco chamava `temporizador.unref()`, copiado do `command-poller`. La
   * faz sentido, porque existe outro handle segurando o processo; aqui o
   * heartbeat e o UNICO timer ativo depois do arranque, e timer `unref`ado
   * nao segura o event loop.
   *
   * Resultado em campo: o agente logava "edge-agent pronto", o Node nao via
   * mais nada pendente e o processo saia com codigo 0 -- sem erro, sem log,
   * sem nunca mandar um heartbeat. O painel mostrava "Sem resposta / nunca"
   * para um agente que "subiu com sucesso".
   *
   * Os testes com `useFakeTimers` nao pegavam: com timer falso, `unref` e
   * inocuo. Este olha o handle de verdade.
   */
  it('mantem o processo vivo -- o timer NAO pode ser unref', async () => {
    const temporizadores: NodeJS.Timeout[] = [];
    const desreferenciados: NodeJS.Timeout[] = [];
    const setTimeoutOriginal = global.setTimeout;

    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(((...args: Parameters<typeof setTimeout>) => {
        const t = setTimeoutOriginal(...args);
        const unrefOriginal = t.unref.bind(t);

        // Registra a chamada sem `spyOn` no metodo: espionar `unref` de um
        // handle real esbarra na regra de `this` do lint.
        t.unref = () => {
          desreferenciados.push(t);

          return unrefOriginal();
        };

        temporizadores.push(t);

        return t;
      }) as typeof setTimeout);

    const cliente = {
      post: jest.fn(() => Promise.resolve({ ok: true, status: 200, body: null, errorCode: null })),
      get: jest.fn(),
    } as unknown as SignedCloudClient;

    const parar = iniciarLacoDeHeartbeat({
      cliente,
      montarCorpo: () => ({
        agentVersion: '1.0.0',
        localTimeMs: Date.now(),
        queueDepth: 0,
        devices: [],
      }),
      intervaloMs: 30_000,
    });

    // O timer do proximo ciclo so nasce DEPOIS do envio imediato, que e
    // assincrono -- por isso a espera antes de olhar o handle.
    await Promise.resolve();
    await Promise.resolve();

    expect(temporizadores).toHaveLength(1);
    expect(desreferenciados).toHaveLength(0);

    parar();
    // `parar()` ja faz `clearTimeout`, mas o handle e real: limpa o que
    // sobrou para o Jest nao esperar o intervalo inteiro para encerrar.
    for (const t of temporizadores) clearTimeout(t);
    jest.restoreAllMocks();
  });

  /**
   * O PRIMEIRO heartbeat sai no arranque, nao 30 s depois.
   *
   * Sem isso, todo reinicio do servico deixa o painel mostrando "Sem
   * resposta" por meio minuto -- e foi parte do que tornou o diagnostico do
   * `unref` confuso em campo: nao dava para distinguir "ainda nao mandou" de
   * "morreu antes de mandar" (#406).
   */
  it('envia o primeiro heartbeat imediatamente, sem esperar o intervalo', async () => {
    /*
     * Timer falso mesmo testando o envio IMEDIATO: sem `unref`, o timer do
     * proximo ciclo e real e seguraria o Jest aberto ate o intervalo
     * inteiro passar.
     */
    jest.useFakeTimers({ doNotFake: ['nextTick'] });

    const post = jest.fn(() =>
      Promise.resolve({ ok: true, status: 200, body: null, errorCode: null }),
    );

    const cliente = { post, get: jest.fn() } as unknown as SignedCloudClient;

    const parar = iniciarLacoDeHeartbeat({
      cliente,
      montarCorpo: () => ({
        agentVersion: '1.0.0',
        localTimeMs: Date.now(),
        queueDepth: 0,
        devices: [],
      }),
      intervaloMs: 30_000,
    });

    // Sem adiantar relogio nenhum: o envio inicial nao depende do timer.
    await Promise.resolve();
    await Promise.resolve();

    expect(post).toHaveBeenCalledTimes(1);

    parar();
    jest.useRealTimers();
  });

  /*
   * O envio IMEDIATO ja saiu quando `parar()` e chamado -- e correto: quem
   * inicia o laco pediu um heartbeat agora. O que `parar()` garante e que
   * nao ha envio ADICIONAL depois dele, por mais que o relogio ande.
   */
  it('nao agenda proxima chamada apos parar', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });

    const post = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: { serverTime: new Date().toISOString(), clockOffsetMs: 0, acknowledgedDevices: 0 },
        errorCode: null,
      }),
    );

    const cliente = {
      post,
      get: jest.fn(),
    } as unknown as SignedCloudClient;

    const parar = iniciarLacoDeHeartbeat({
      cliente,
      montarCorpo: () => ({ agentVersion: '1.0.0', localTimeMs: Date.now(), queueDepth: 0, devices: [] }),
      intervaloMs: 1_000,
    });

    // Deixa o envio imediato terminar antes de parar.
    await Promise.resolve();
    await Promise.resolve();

    const enviosAteParar = post.mock.calls.length;

    parar();

    jest.advanceTimersByTime(10_000);

    expect(post).toHaveBeenCalledTimes(enviosAteParar);

    jest.useRealTimers();
  });
});
