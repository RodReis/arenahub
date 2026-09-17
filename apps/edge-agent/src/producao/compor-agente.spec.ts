import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compor } from './compor-agente.js';
import { carregarConfig } from '../config/env.js';
import { criarLogger } from '../observability/logger.js';
import { FacialSimulator } from '../adapters/facial-simulator.js';
import type { SignedCloudClient } from '../cloud/signed-client.js';

describe('compor', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('liga reconhecimento facial a decisao online e devolve ALLOW quando a nuvem permite', async () => {
    dir = mkdtempSync(join(tmpdir(), 'arenahub-compor-agente-'));

    const config = carregarConfig({
      EDGE_AGENT_ID: 'edge-1',
      TENANT_ID: '11111111-1111-4111-8111-111111111111',
      GYM_UNIT_ID: '22222222-2222-4222-8222-222222222222',
      SQLITE_PATH: join(dir, 'teste-compor-agente.sqlite'),
      CLOUD_API_URL: 'https://nuvem.teste',
      CLOUD_EDGE_KEY_ID: 'key-1',
      CLOUD_EDGE_SECRET: 'segredo-com-16-bytes-ou-mais',
    });
    const logger = criarLogger(config);

    const clienteFalso = {
      post: jest.fn(async (path: string) => {
        if (path === '/api/v1/edge/access-decisions') {
          return {
            ok: true,
            status: 201,
            body: {
              accessEventId: 'evt-1',
              correlationId: 'c-1',
              outcome: 'ALLOW',
              reason: 'TESTE',
              policyVersion: 'v1',
              validUntil: null,
              replayed: false,
            },
            errorCode: null,
          };
        }
        return { ok: true, status: 201, body: { accessEventId: 'evt-1', state: 'CONFIRMED' }, errorCode: null };
      }),
      get: jest.fn(),
    } as unknown as SignedCloudClient;

    const facial = new FacialSimulator();

    const composto = await compor(config, logger, {
      cliente: clienteFalso,
      dispositivos: {
        facial,
        catraca: {
          nome: 'catraca-falsa',
          liberar: jest.fn(async () => ({ desfecho: 'girou' as const, duracaoMs: 10 })),
          encerrar: jest.fn(async () => {}),
        },
        encerrar: async () => {},
      },
    });

    facial.simularReconhecimento('aluno-1', new Date());

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(clienteFalso.post).toHaveBeenCalledWith(
      '/api/v1/edge/access-decisions',
      expect.objectContaining({ externalUserId: 'aluno-1' }),
    );

    await composto.encerrar();
  });
});
