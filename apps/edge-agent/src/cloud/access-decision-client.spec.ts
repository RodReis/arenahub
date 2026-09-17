import { describe, expect, it, jest } from '@jest/globals';

import { criarPedirDecisao, criarReportarPassagem } from './access-decision-client.js';
import type { SignedCloudClient } from './signed-client.js';

function clienteFalso(
  resposta: unknown,
  ok = true,
  status = 201,
): { cliente: SignedCloudClient; postMock: jest.Mock } {
  const postMock = jest.fn(() =>
    Promise.resolve({ ok, status, body: ok ? resposta : null, errorCode: ok ? null : 'ERRO' }),
  );
  const cliente = { post: postMock, get: jest.fn() } as unknown as SignedCloudClient;
  return { cliente, postMock };
}

describe('criarPedirDecisao', () => {
  it('monta o payload e devolve a decisao em caso de sucesso', async () => {
    const { cliente, postMock } = clienteFalso({
      accessEventId: 'evt-1', correlationId: 'c-1', outcome: 'ALLOW', reason: 'ENTITLEMENT_ACTIVE',
      policyVersion: 'v1', validUntil: null, replayed: false,
    });
    const pedirDecisao = criarPedirDecisao(cliente);

    const resultado = await pedirDecisao({
      deviceId: 'dev-1', externalUserId: 'user-1', recognitionId: 'rec-1',
      recognizedAt: new Date('2026-09-16T10:00:00Z'), idempotencyKey: 'idem-1',
    });

    expect(resultado).toEqual({
      accessEventId: 'evt-1', outcome: 'ALLOW', reason: 'ENTITLEMENT_ACTIVE', validUntil: null,
    });
    expect(postMock).toHaveBeenCalledWith('/api/v1/edge/access-decisions', {
      deviceId: 'dev-1', externalUserId: 'user-1', recognitionId: 'rec-1',
      recognizedAt: '2026-09-16T10:00:00.000Z', idempotencyKey: 'idem-1',
    });
  });

  it('devolve null quando a nuvem responde erro -- vira DENY explicito rio acima', async () => {
    const { cliente } = clienteFalso(null, false, 0);
    const pedirDecisao = criarPedirDecisao(cliente);

    const resultado = await pedirDecisao({
      deviceId: 'dev-1', externalUserId: 'user-1', recognitionId: 'rec-1',
      recognizedAt: new Date(), idempotencyKey: 'idem-1',
    });

    expect(resultado).toBeNull();
  });
});

describe('criarReportarPassagem', () => {
  it('reporta o desfecho e devolve true em sucesso', async () => {
    const { cliente, postMock } = clienteFalso({ accessEventId: 'evt-1', state: 'CONFIRMED' });
    const reportarPassagem = criarReportarPassagem(cliente);

    const ok = await reportarPassagem('evt-1', 'CONFIRMED', 'cmd-1', new Date('2026-09-16T10:00:05Z'));

    expect(ok).toBe(true);
    expect(postMock).toHaveBeenCalledWith('/api/v1/edge/access-events/evt-1/passage', {
      state: 'CONFIRMED', commandId: 'cmd-1', reportedAt: '2026-09-16T10:00:05.000Z',
    });
  });

  it('devolve false quando a nuvem recusa', async () => {
    const { cliente } = clienteFalso(null, false);
    const reportarPassagem = criarReportarPassagem(cliente);

    const ok = await reportarPassagem('evt-1', 'TIMED_OUT', 'cmd-1', new Date());

    expect(ok).toBe(false);
  });
});
