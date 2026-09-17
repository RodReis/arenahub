import { describe, expect, it, jest } from '@jest/globals';

import { enviarHeartbeat } from './heartbeat-client.js';
import type { SignedCloudClient } from './signed-client.js';

describe('enviarHeartbeat', () => {
  it('envia o corpo e devolve a resposta em sucesso', async () => {
    const postMock = jest.fn(() =>
      Promise.resolve({
        ok: true, status: 200,
        body: { serverTime: '2026-09-16T10:00:00.000Z', clockOffsetMs: 12, acknowledgedDevices: 2 },
        errorCode: null,
      }),
    );
    const cliente = { post: postMock, get: jest.fn() } as unknown as SignedCloudClient;

    const resultado = await enviarHeartbeat(cliente, {
      agentVersion: '1.0.0', localTimeMs: 1_757_000_000_000, queueDepth: 3, devices: [],
    });

    expect(resultado).toEqual({ serverTime: '2026-09-16T10:00:00.000Z', clockOffsetMs: 12, acknowledgedDevices: 2 });
    expect(postMock).toHaveBeenCalledWith('/api/v1/edge/heartbeat', {
      agentVersion: '1.0.0', localTimeMs: 1_757_000_000_000, queueDepth: 3, devices: [],
    });
  });

  it('devolve null quando a nuvem nao responde -- nao derruba o processo', async () => {
    const cliente = {
      post: jest.fn(() => Promise.resolve({ ok: false, status: 0, body: null, errorCode: 'CLOUD_UNREACHABLE' })),
      get: jest.fn(),
    } as unknown as SignedCloudClient;

    const resultado = await enviarHeartbeat(cliente, {
      agentVersion: '1.0.0', localTimeMs: Date.now(), queueDepth: 0, devices: [],
    });

    expect(resultado).toBeNull();
  });
});
