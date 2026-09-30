import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';

import { compor } from './compor-agente.js';
import { carregarConfig } from '../config/env.js';
import { criarLogger } from '../observability/logger.js';
import { FacialSimulator } from '../adapters/facial-simulator.js';
import type { SignedCloudClient } from '../cloud/signed-client.js';

/**
 * Espera ATE a condicao valer, com teto. Janela fixa passava no Windows e
 * estourava no CI, com todos os pacotes testando em paralelo.
 */
async function ate(condicao: () => boolean, tetoMs = 2_000): Promise<void> {
  const limite = Date.now() + tetoMs;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error('condicao nao ocorreu a tempo');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const chamou = (mock: { mock: { calls: unknown[][] } }, caminho: string, vezes = 1): boolean =>
  mock.mock.calls.filter(([path]) => path === caminho).length >= vezes;

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

  /**
   * #467 -- Arena Positiva, 30/09/2026. O leitor reconheceu duas pessoas e
   * nenhum evento chegou ao painel: o Edge mandava o proprio `EDGE_AGENT_ID`
   * onde a nuvem espera o leitor, a validacao recusava e o log ficava mudo --
   * o caminho de producao so registrava excecao, nunca a decisao.
   */
  describe('#467 -- leitor pelo serial e decisao visivel no log', () => {
    const montar = async (linhas: Record<string, unknown>[]) => {
      dir = mkdtempSync(join(tmpdir(), 'arenahub-compor-agente-467-'));

      const config = carregarConfig({
        EDGE_AGENT_ID: 'edge-1',
        TENANT_ID: '11111111-1111-4111-8111-111111111111',
        GYM_UNIT_ID: '22222222-2222-4222-8222-222222222222',
        SQLITE_PATH: join(dir, 'teste-467.sqlite'),
        CLOUD_API_URL: 'https://nuvem.teste',
      });
      const logger = pino(
        { level: 'info' },
        { write: (linha: string) => linhas.push(JSON.parse(linha) as Record<string, unknown>) },
      );

      const postMock = jest.fn((path: string) =>
        Promise.resolve(
          path === '/api/v1/edge/access-decisions'
            ? {
                ok: true,
                status: 201,
                body: {
                  accessEventId: 'evt-467',
                  correlationId: 'c-467',
                  outcome: 'DENY',
                  reason: 'NO_ENTITLEMENT',
                  policyVersion: 'v1',
                  validUntil: null,
                  replayed: false,
                },
                errorCode: null,
              }
            : { ok: true, status: 201, body: {}, errorCode: null },
        ),
      );
      const facial = new FacialSimulator();

      const composto = await compor(config, logger, {
        cliente: { post: postMock, get: jest.fn() } as unknown as SignedCloudClient,
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

      return { composto, facial, postMock };
    };

    it('manda o serial do leitor que reconheceu, nunca o EDGE_AGENT_ID', async () => {
      const { composto, facial, postMock } = await montar([]);

      facial.simularReconhecimento('aluno-1', new Date());
      await ate(() => chamou(postMock, '/api/v1/edge/access-decisions'));

      // O mock declara so o `path`; o corpo chega como segundo argumento.
      const chamadas = postMock.mock.calls as unknown as [string, Record<string, unknown>][];
      const corpo = chamadas.find(([path]) => path === '/api/v1/edge/access-decisions')?.[1];

      expect(corpo).toMatchObject({ deviceSerial: facial.serie });
      expect(corpo).not.toHaveProperty('deviceId');

      await composto.encerrar();
    });

    /*
     * #476 -- passagem de horas atras (backlog do leitor ao reconectar) nao e
     * pessoa na frente da catraca. Nao pede decisao, nao gira nada.
     */
    it('passagem antiga do leitor nao pede decisao nem aciona a catraca (#476)', async () => {
      const linhas: Record<string, unknown>[] = [];
      const { composto, facial, postMock } = await montar(linhas);

      const umaHoraAtras = new Date(Date.now() - 3_600_000);
      facial.simularReconhecimento('aluno-1', umaHoraAtras, 'facial', new Date());
      await ate(() => chamou(postMock, '/api/v1/edge/offline-passages'));

      expect(postMock).not.toHaveBeenCalledWith('/api/v1/edge/access-decisions', expect.anything());
      expect(linhas).toContainEqual(
        expect.objectContaining({ msg: 'passagem antiga do leitor -- nao aciona a catraca' }),
      );

      await composto.encerrar();
    });

    /*
     * #477 -- decisao do PI (30/09/2026): a passagem antiga CONTA como
     * frequencia. O Edge relata o FATO -- horario do equipamento, leitor e
     * numero --, nunca o outcome: quem decidiu foi a catraca, offline.
     */
    it('passagem antiga vai para a nuvem como frequencia, com o horario do equipamento (#477)', async () => {
      const { composto, facial, postMock } = await montar([]);

      const umaHoraAtras = new Date(Date.now() - 3_600_000);
      facial.simularReconhecimento('aluno-1', umaHoraAtras, 'facial', new Date());
      await ate(() => chamou(postMock, '/api/v1/edge/offline-passages'));

      const chamadas = postMock.mock.calls as unknown as [string, Record<string, unknown>][];
      const corpo = chamadas.find(([path]) => path === '/api/v1/edge/offline-passages')?.[1];

      expect(corpo).toMatchObject({
        deviceSerial: facial.serie,
        externalUserId: 'aluno-1',
        occurredAt: umaHoraAtras.toISOString(),
      });
      expect(corpo).not.toHaveProperty('outcome');
      expect(corpo).not.toHaveProperty('reason');

      await composto.encerrar();
    });

    it('a MESMA passagem antiga gera a MESMA chave -- reenvio do leitor nao duplica (#477)', async () => {
      const { composto, facial, postMock } = await montar([]);

      const umaHoraAtras = new Date(Date.now() - 3_600_000);
      facial.simularReconhecimento('aluno-1', umaHoraAtras, 'facial', new Date());
      facial.simularReconhecimento('aluno-1', umaHoraAtras, 'facial', new Date());
      await ate(() => chamou(postMock, '/api/v1/edge/offline-passages', 2));

      const chamadas = postMock.mock.calls as unknown as [string, Record<string, unknown>][];
      const chaves = chamadas
        .filter(([path]) => path === '/api/v1/edge/offline-passages')
        .map(([, corpo]) => corpo['idempotencyKey']);

      expect(chaves).toHaveLength(2);
      expect(chaves[0]).toBe(chaves[1]);

      await composto.encerrar();
    });

    it('registra cada decisao em log, com o motivo', async () => {
      const linhas: Record<string, unknown>[] = [];
      const { composto, facial } = await montar(linhas);

      facial.simularReconhecimento('aluno-1', new Date());
      await ate(() => linhas.some((l) => l['msg'] === 'decisao de acesso'));

      expect(linhas).toContainEqual(
        expect.objectContaining({
          msg: 'decisao de acesso',
          enrollid: 'aluno-1',
          outcome: 'DENY',
          reason: 'NO_ENTITLEMENT',
        }),
      );

      await composto.encerrar();
    });
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
