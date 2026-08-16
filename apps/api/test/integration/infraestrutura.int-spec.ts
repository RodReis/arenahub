import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { OBJECT_STORAGE, montarChaveDeCadastro } from '../../src/common/storage/object-storage.port.js';
import { VerificadorDeBanco } from '../../src/health/verificador-de-banco.js';
import { VerificadorDeRedis } from '../../src/health/verificador-de-redis.js';

/**
 * Readiness precisa distinguir QUAL dependencia caiu.
 *
 * Um `503` generico obriga quem esta de plantao a adivinhar entre Postgres,
 * Redis e storage -- e a fila de sync biometrico depende dos tres. Aqui cada
 * uma cai isolada e o corpo tem de dizer o nome dela.
 */
describe('readiness por dependencia', () => {
  let app: INestApplication;

  const estado = { banco: true, redis: true, storage: true };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(VerificadorDeBanco)
      .useValue({ verificar: (): Promise<boolean> => Promise.resolve(estado.banco) })
      .overrideProvider(VerificadorDeRedis)
      .useValue({ verificar: (): Promise<boolean> => Promise.resolve(estado.redis) })
      .overrideProvider(OBJECT_STORAGE)
      .useValue({ verificar: (): Promise<boolean> => Promise.resolve(estado.storage) })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const restaurar = (): void => {
    estado.banco = true;
    estado.redis = true;
    estado.storage = true;
  };

  it('reporta as tres dependencias quando todas atendem', async () => {
    restaurar();

    const resposta = await request(servidor()).get('/health/ready');

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({
      status: 'ready',
      dependencies: { database: 'up', redis: 'up', objectStorage: 'up' },
    });
  });

  it('identifica o Redis fora sem derrubar o diagnostico das outras', async () => {
    restaurar();
    estado.redis = false;

    const resposta = await request(servidor()).get('/health/ready');

    expect(resposta.status).toBe(503);
    expect(resposta.body).toMatchObject({
      unavailable: { redis: 'HEALTH_REDIS_UNAVAILABLE' },
    });
    // Banco e storage estavam de pe: nao podem aparecer como queda.
    expect((resposta.body as { unavailable: Record<string, string> }).unavailable)
      .not.toHaveProperty('database');
  });

  it('identifica o storage fora', async () => {
    restaurar();
    estado.storage = false;

    const resposta = await request(servidor()).get('/health/ready');

    expect(resposta.status).toBe(503);
    expect(resposta.body).toMatchObject({
      unavailable: { objectStorage: 'HEALTH_OBJECT_STORAGE_UNAVAILABLE' },
    });
  });

  it('lista todas as quedas quando mais de uma dependencia cai', async () => {
    restaurar();
    estado.redis = false;
    estado.storage = false;

    const resposta = await request(servidor()).get('/health/ready');
    const quedas = (resposta.body as { unavailable: Record<string, string> }).unavailable;

    expect(resposta.status).toBe(503);
    expect(Object.keys(quedas).sort()).toEqual(['objectStorage', 'redis']);
  });

  it('liveness ignora dependencia caida', async () => {
    restaurar();
    estado.banco = false;
    estado.redis = false;
    estado.storage = false;

    const resposta = await request(servidor()).get('/health/live');

    // Reiniciar a API nao levanta Redis nem Postgres -- por isso liveness
    // nao pode depender deles.
    expect(resposta.status).toBe(200);

    restaurar();
  });

  it('nunca expoe credencial nem endereco de dependencia no corpo de erro', async () => {
    restaurar();
    estado.banco = false;
    estado.redis = false;
    estado.storage = false;

    const resposta = await request(servidor()).get('/health/ready');
    const corpo = JSON.stringify(resposta.body);

    expect(corpo).not.toMatch(/postgres(ql)?:\/\//i);
    expect(corpo).not.toMatch(/redis:\/\//i);
    expect(corpo).not.toMatch(/password|secret|access.?key/i);
    expect(corpo).not.toMatch(/127\.0\.0\.1|localhost/i);

    restaurar();
  });
});

describe('chave do objeto de cadastro', () => {
  const tenant = '11111111-1111-4111-8111-111111111111';
  const identidade = '22222222-2222-4222-8222-222222222222';

  it('e gerada pelo servidor com o tenant no prefixo', () => {
    const chave = montarChaveDeCadastro(tenant, identidade);

    // Prefixo do tenant e o que impede o tenant A de escrever no espaco do B
    // (regra de arquitetura no 2).
    expect(chave).toBe(`tenants/${tenant}/biometrics/${identidade}/enrollment`);
  });

  it('nao carrega identificacao pessoal na chave', () => {
    const chave = montarChaveDeCadastro(tenant, identidade);

    // Quem listar o bucket ve UUID, nao gente (INV-012, espirito do INV-022).
    expect(chave).not.toMatch(/cpf|nome|name|matricula/i);
  });
});
