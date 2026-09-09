import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPrismaClient, type PrismaClientArenaHub } from '../src/index.js';

/**
 * Prova no banco as tres alteracoes de schema da F61 (ADR-052).
 *
 * Sao constraints, nao regra de aplicacao: `PlatformAuditLog` sem tenant,
 * `Session` sem tenant e `TenantStatus.INACTIVE` ou existem no Postgres ou
 * nao existem. Teste de codigo nao consegue dizer a diferenca.
 */
describe('schema da plataforma (F61)', () => {
  let db: PrismaClientArenaHub;

  const sufixo = randomUUID().slice(0, 8);

  beforeAll(() => {
    db = criarPrismaClient();
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it('grava PlatformAuditLog sem tenant, porque ato de plataforma nao tem tenant dono', async () => {
    const registro = await db.platformAuditLog.create({
      data: {
        action: 'tenant.created',
        target: 'tenant',
        correlationId: `teste-f61-${sufixo}`,
      },
    });

    expect(registro.tenantId).toBeNull();
    expect(registro.occurredAt).toBeInstanceOf(Date);
  });

  it('aceita Session sem tenant, porque a sessao de plataforma nao esta em tenant nenhum', async () => {
    const usuario = await db.user.create({
      data: { email: `f61-sessao-${sufixo}@teste.local`, passwordHash: 'x' },
    });

    const sessao = await db.session.create({
      data: {
        userId: usuario.id,
        tenantId: null,
        tokenHash: `hash-${sufixo}`,
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(sessao.tenantId).toBeNull();
  });

  it('aceita TenantStatus INACTIVE, que e o desligamento pelo dono do SaaS', async () => {
    const tenant = await db.tenant.create({
      data: {
        slug: `f61-inativo-${sufixo}`,
        legalName: 'Academia Teste LTDA',
        displayName: 'Academia Teste',
        status: 'INACTIVE',
      },
    });

    expect(tenant.status).toBe('INACTIVE');
  });
});
