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

  it('nao agenda proxima chamada apos parar', () => {
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
      intervaloMs: 1_000,
    });

    parar();

    jest.advanceTimersByTime(10_000);

    expect(post).not.toHaveBeenCalled();

    jest.useRealTimers();
  });
});
