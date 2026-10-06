import { Controller, Get, Req, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from '@jest/globals';
import type { Request } from 'express';
import request from 'supertest';

import { aplicarTrustProxy } from './bootstrap-http.js';

@Controller('eco')
class EcoController {
  @Get()
  ip(@Req() requisicao: Request): { ip: string | undefined } {
    return { ip: requisicao.ip };
  }
}

/** #605: `req.ip` com e sem proxy confiavel. */
describe('aplicarTrustProxy', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const ipVisto = async (saltos: number, forwardedFor: string): Promise<string | undefined> => {
    const modulo = await Test.createTestingModule({ controllers: [EcoController] }).compile();

    app = modulo.createNestApplication();
    aplicarTrustProxy(app, saltos);
    await app.init();

    const servidor = app.getHttpServer() as Parameters<typeof request>[0];
    const resposta = await request(servidor)
      .get('/eco')
      .set('X-Forwarded-For', forwardedFor);

    return (resposta.body as { ip?: string }).ip;
  };

  it('com 0 saltos ignora o X-Forwarded-For e usa o socket (comportamento de hoje)', async () => {
    const ip = await ipVisto(0, '203.0.113.7');

    expect(ip).not.toBe('203.0.113.7');
    expect(ip).toMatch(/127\.0\.0\.1$/);
  });

  it('com 1 salto le o IP do cliente que o proxy anexou', async () => {
    expect(await ipVisto(1, '203.0.113.7')).toBe('203.0.113.7');
  });

  it('com 1 salto ignora o que o cliente escreveu a esquerda: nao da para forjar o IP', async () => {
    expect(await ipVisto(1, '6.6.6.6, 203.0.113.7')).toBe('203.0.113.7');
  });
});
