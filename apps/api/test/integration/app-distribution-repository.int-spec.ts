import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { comContexto } from '@arenahub/database';

import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { AppDistributionRepository } from '../../src/modules/app-distribution/app-distribution.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

describe('AppDistributionRepository', () => {
  let repo: AppDistributionRepository;
  let db: PrismaService;
  let tenantA: string;
  let tenantB: string;
  let usuarioId: string;
  const sufixo = `${Date.now()}`;

  const ctx = (tenantId: string, actorId: string | null = null) =>
    ({ tenantId, actorId }) as unknown as TenantContext;
  const como = <T>(tenantId: string, fn: () => Promise<T>) =>
    comContexto({ kind: 'tenant', tenantId }, fn);

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [AppDistributionRepository, PrismaService],
    }).compile();
    repo = ref.get(AppDistributionRepository);
    db = ref.get(PrismaService);

    const a = await db.tenant.create({
      data: { slug: `app-a-${sufixo}`, legalName: `A ${sufixo}`, displayName: `A ${sufixo}` },
    });
    const b = await db.tenant.create({
      data: { slug: `app-b-${sufixo}`, legalName: `B ${sufixo}`, displayName: `B ${sufixo}` },
    });
    tenantA = a.id;
    tenantB = b.id;

    const usuario = await db.user.create({
      data: { email: `gerente-${sufixo}@teste.local`, passwordHash: 'x' },
    });
    usuarioId = usuario.id;
    const papel = await db.role.create({ data: { tenantId: tenantA, name: 'MANAGER' } });
    await db.userRole.create({ data: { tenantId: tenantA, userId: usuarioId, roleId: papel.id } });
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.user.deleteMany({ where: { id: usuarioId } });
  });

  it('devolve null quando a academia nao configurou', async () => {
    expect(await como(tenantA, () => repo.obter(ctx(tenantA)))).toBeNull();
  });

  it('salva e le; salvar de novo substitui (upsert por tenant)', async () => {
    await como(tenantA, () =>
      repo.salvar(ctx(tenantA), { androidUrl: 'https://expo.dev/a.apk', androidVersion: '0.1.0' }),
    );
    await como(tenantA, () =>
      repo.salvar(ctx(tenantA), { androidUrl: 'https://expo.dev/b.apk', androidVersion: null }),
    );

    const lido = await como(tenantA, () => repo.obter(ctx(tenantA)));
    expect(lido?.androidUrl).toBe('https://expo.dev/b.apk');
    expect(lido?.androidVersion).toBeNull();
  });

  it('guarda quem salvou: e-mail e perfil na academia', async () => {
    await como(tenantA, () =>
      repo.salvar(ctx(tenantA, usuarioId), { androidUrl: 'https://expo.dev/c.apk', androidVersion: null }),
    );

    const lido = await como(tenantA, () => repo.obter(ctx(tenantA)));
    expect(lido?.updatedByEmail).toBe(`gerente-${sufixo}@teste.local`);
    expect(lido?.updatedByRole).toBe('MANAGER');
  });

  it('uma academia nao le a linha da outra', async () => {
    expect(await como(tenantB, () => repo.obter(ctx(tenantB)))).toBeNull();
  });

  it('remover apaga so a propria linha e e idempotente', async () => {
    await como(tenantB, () =>
      repo.salvar(ctx(tenantB), { androidUrl: 'https://expo.dev/b2.apk', androidVersion: null }),
    );

    await como(tenantA, () => repo.remover(ctx(tenantA)));
    await como(tenantA, () => repo.remover(ctx(tenantA)));

    expect(await como(tenantA, () => repo.obter(ctx(tenantA)))).toBeNull();
    expect(await como(tenantB, () => repo.obter(ctx(tenantB)))).not.toBeNull();
  });
});
