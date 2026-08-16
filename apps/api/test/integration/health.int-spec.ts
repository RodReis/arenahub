import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import { VerificadorDeBanco } from '../../src/health/verificador-de-banco.js';
import { VerificadorDeRedis } from '../../src/health/verificador-de-redis.js';

/**
 * `M1-NFR-005` exige RTO documentado; antes disso, exige saber se a API esta
 * de pe. Liveness e readiness respondem perguntas diferentes:
 *
 * - `live` -- o processo respira? Nao toca no banco. Se dependesse do banco,
 *   o orquestrador reiniciaria a API por causa de uma queda do Postgres, que
 *   reiniciar nao conserta.
 * - `ready` -- da para mandar trafego? Ai sim consulta o banco.
 */
describe('health e version', () => {
  let app: INestApplication;
  let bancoDisponivel = true;

  // `getHttpServer()` e tipado como `any` pelo Nest. Estreitar aqui, num
  // ponto so, evita espalhar `no-unsafe-argument` por cada chamada.
  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(VerificadorDeBanco)
      .useValue({
        verificar: (): Promise<boolean> => Promise.resolve(bancoDisponivel),
      })
      // Redis e storage entraram no readiness na F8. Esta suite e sobre o
      // BANCO: mantidos sempre de pe para que a falha aqui signifique o que o
      // nome do teste diz, e nao "o MinIO local estava fora".
      .overrideProvider(VerificadorDeRedis)
      .useValue({ verificar: (): Promise<boolean> => Promise.resolve(true) })
      .overrideProvider(OBJECT_STORAGE)
      .useValue({ verificar: (): Promise<boolean> => Promise.resolve(true) })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /health/live', () => {
    it('responde 200 sem depender do banco', async () => {
      bancoDisponivel = false;

      const resposta = await request(servidor()).get('/health/live');

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({ status: 'live' });

      bancoDisponivel = true;
    });
  });

  describe('GET /health/ready', () => {
    it('responde 200 quando o banco responde', async () => {
      bancoDisponivel = true;

      const resposta = await request(servidor()).get('/health/ready');

      expect(resposta.status).toBe(200);
      // `dependencies` entrou na F8: readiness passou a dizer QUAL
      // dependencia esta de pe, nao so que ha alguma. Contrato ampliado --
      // `status: 'ready'` continua sendo o que a sonda le.
      expect(resposta.body).toMatchObject({ status: 'ready' });
    });

    it('responde 503 com codigo estavel quando o banco nao responde', async () => {
      bancoDisponivel = false;

      const resposta = await request(servidor()).get('/health/ready');

      expect(resposta.status).toBe(503);
      expect(resposta.body).toMatchObject({ code: 'HEALTH_DATABASE_UNAVAILABLE' });

      bancoDisponivel = true;
    });

    it('nunca expoe a string de conexao, nem quando o banco falha', async () => {
      bancoDisponivel = false;

      const resposta = await request(servidor()).get('/health/ready');
      const corpo = JSON.stringify(resposta.body);

      // Vazar credencial em corpo de erro e o jeito mais banal de entregar o
      // banco -- `CLAUDE.md`, Convencoes de codigo.
      expect(corpo).not.toMatch(/postgres(ql)?:\/\//i);
      expect(corpo).not.toMatch(/password/i);

      bancoDisponivel = true;
    });
  });

  describe('GET /version', () => {
    it('devolve a versao da api', async () => {
      const resposta = await request(servidor()).get('/version');

      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({ version: expect.any(String) });
      expect((resposta.body as { version: string }).version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});
