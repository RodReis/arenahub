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

    const postMock = jest.fn((path: string) => {
      if (path === '/api/v1/edge/access-decisions') {
        return Promise.resolve({
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
        });
      }
      return Promise.resolve({
        ok: true,
        status: 201,
        body: { accessEventId: 'evt-1', state: 'CONFIRMED' },
        errorCode: null,
      });
    });
    const clienteFalso = { post: postMock, get: jest.fn() } as unknown as SignedCloudClient;

    const facial = new FacialSimulator();

    const composto = await compor(config, logger, {
      cliente: clienteFalso,
      dispositivos: {
        facial,
        catraca: {
          nome: 'catraca-falsa',
          liberar: jest.fn(() => Promise.resolve({ desfecho: 'girou' as const, duracaoMs: 10 })),
          encerrar: jest.fn(() => Promise.resolve()),
        },
        encerrar: () => Promise.resolve(),
      },
    });

    facial.simularReconhecimento('aluno-1', new Date());

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(postMock).toHaveBeenCalledWith(
      '/api/v1/edge/access-decisions',
      expect.objectContaining({ externalUserId: 'aluno-1' }),
    );

    await composto.encerrar();
  });

  it('uma tentativa em COMMAND_PENDING sobrevive ao encerramento e e reportada na proxima composicao', async () => {
    dir = mkdtempSync(join(tmpdir(), 'arenahub-compor-agente-retomada-'));
    const caminhoSqlite = join(dir, 'teste-retomada.sqlite');

    const config = carregarConfig({
      EDGE_AGENT_ID: 'edge-1',
      TENANT_ID: '11111111-1111-4111-8111-111111111111',
      GYM_UNIT_ID: '22222222-2222-4222-8222-222222222222',
      SQLITE_PATH: caminhoSqlite,
      CLOUD_API_URL: 'https://nuvem.teste',
      CLOUD_EDGE_KEY_ID: 'key-1',
      CLOUD_EDGE_SECRET: 'segredo-com-16-bytes-ou-mais',
    });
    const logger = criarLogger(config);

    // Simula reportarPassagem falhando na primeira composicao (rede caiu bem
    // no momento do report), deixando a tentativa pendente.
    const clienteQueFalhaNoReport = {
      post: jest.fn((path: string) => {
        if (path === '/api/v1/edge/access-decisions') {
          return Promise.resolve({
            ok: true,
            status: 201,
            body: {
              accessEventId: 'evt-2',
              correlationId: 'c-2',
              outcome: 'ALLOW',
              reason: 'TESTE',
              policyVersion: 'v1',
              validUntil: null,
              replayed: false,
            },
            errorCode: null,
          });
        }
        return Promise.resolve({ ok: false, status: 0, body: null, errorCode: 'CLOUD_UNREACHABLE' });
      }),
      get: jest.fn(),
    } as unknown as SignedCloudClient;

    const facialDaPrimeiraComposicao = new FacialSimulator();

    const primeiraComposicao = await compor(config, logger, {
      cliente: clienteQueFalhaNoReport,
      dispositivos: {
        facial: facialDaPrimeiraComposicao,
        catraca: {
          nome: 'catraca-falsa',
          liberar: jest.fn(() => Promise.resolve({ desfecho: 'girou' as const, duracaoMs: 10 })),
          encerrar: jest.fn(() => Promise.resolve()),
        },
        encerrar: () => Promise.resolve(),
      },
    });

    facialDaPrimeiraComposicao.simularReconhecimento('aluno-2', new Date());

    await new Promise((resolve) => setTimeout(resolve, 50));
    await primeiraComposicao.encerrar();

    // Segunda composicao, agora com a nuvem respondendo: retomarPendentes
    // deve reportar a tentativa presa, sem recomandar a catraca.
    const catracaDaSegundaComposicao = {
      nome: 'catraca-falsa-2',
      liberar: jest.fn(() => Promise.resolve({ desfecho: 'girou' as const, duracaoMs: 10 })),
      encerrar: jest.fn(() => Promise.resolve()),
    };

    const postMockDaSegundaComposicao = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 201,
        body: { accessEventId: 'evt-2', state: 'TIMED_OUT' },
        errorCode: null,
      }),
    );
    const clienteQueFunciona = {
      post: postMockDaSegundaComposicao,
      get: jest.fn(),
    } as unknown as SignedCloudClient;

    const segundaComposicao = await compor(config, logger, {
      cliente: clienteQueFunciona,
      dispositivos: {
        facial: new FacialSimulator(),
        catraca: catracaDaSegundaComposicao,
        encerrar: () => Promise.resolve(),
      },
    });

    expect(postMockDaSegundaComposicao).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/edge/access-events/evt-2/passage'),
      expect.objectContaining({ commandId: expect.any(String) }),
    );

    // A regra central de retomarPendentes: nunca recomanda a catraca.
    expect(catracaDaSegundaComposicao.liberar).not.toHaveBeenCalled();

    await segundaComposicao.encerrar();
  });
});
