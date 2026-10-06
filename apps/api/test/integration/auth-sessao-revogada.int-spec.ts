import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * #582 -- logout, troca de senha e revogacao de acesso derrubam a SESSAO, mas o
 * `AuthGuard` so validava o JWT: o token de acesso seguia aceito por ate dez
 * minutos depois disso.
 */
describe('AuthGuard confere o status da sessao (#582)', () => {
  let app: INestApplication;
  let db: PrismaService;
  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-sessao';
  let tenantId = '';
  let userId = '';
  let cookie = '';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const perfil = () => request(servidor()).get('/api/v1/auth/profile').set('Cookie', cookie);

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: { slug: `sess-${sufixo}`, legalName: `Sess ${sufixo} LTDA`, displayName: 'Sess' },
    });
    tenantId = tenant.id;

    const email = `sess-${sufixo}@exemplo.test`;
    const usuario = await db.user.create({
      data: { email, passwordHash: await app.get(PasswordService).gerarHash(SENHA) },
    });
    userId = usuario.id;
    await db.tenantMembership.create({ data: { tenantId, userId } });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email, password: SENHA });
    const cabecalho: unknown = login.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];
    cookie = lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: tenantId } });
    await db.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  it('sessao ativa passa', async () => {
    expect((await perfil()).status).toBe(200);
  });

  it('sessao ROTATED passa: requisicao em voo depois de um refresh nao desloga', async () => {
    await db.session.updateMany({ where: { userId }, data: { status: 'ROTATED' } });

    expect((await perfil()).status).toBe(200);
  });

  it('sessao REVOKED e recusada na hora, sem esperar o token expirar', async () => {
    await db.session.updateMany({
      where: { userId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'logout' },
    });

    expect((await perfil()).status).toBe(401);
  });
});
