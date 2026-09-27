import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { comContexto } from '@arenahub/database';

import { PrismaService } from '../../src/persistence/prisma.service.js';
import { TenantRepository } from '../../src/modules/platform/tenant.repository.js';

/**
 * `ativosPorTenant()` alimenta a coluna de alunos da lista de academias no
 * painel de plataforma -- issue #423, mesmo defeito da #413 (F81): sem
 * filtro de `profile`, professor, staff e admin entravam no `groupBy`.
 */
describe('TenantRepository.ativosPorTenant filtra profile != STUDENT (issue #423)', () => {
  let repo: TenantRepository;
  let db: PrismaService;
  let tenantId: string;
  let gymUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [TenantRepository, PrismaService],
    }).compile();

    repo = moduleRef.get(TenantRepository);
    db = moduleRef.get(PrismaService);

    tenantId = randomUUID();
    await db.tenant.create({
      data: {
        id: tenantId,
        slug: `f423c-${tenantId.slice(0, 8)}`,
        legalName: 'Tenant F423c LTDA',
        displayName: 'Tenant F423c',
      },
    });
    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: 'F423C',
        name: 'Unidade F423c',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    gymUnitId = unidade.id;

    await db.student.createMany({
      data: [
        {
          tenantId,
          gymUnitId,
          membershipNumber: 'F423C-0001',
          fullName: 'Aluno Ativo',
          birthDate: new Date('1995-01-01'),
          profile: 'STUDENT',
          status: 'ACTIVE',
        },
        {
          tenantId,
          gymUnitId,
          membershipNumber: 'F423C-0002',
          fullName: 'Professor Titular',
          birthDate: new Date('1985-01-01'),
          profile: 'TRAINER',
          status: 'ACTIVE',
        },
        {
          tenantId,
          gymUnitId,
          membershipNumber: 'F423C-0003',
          fullName: 'Admin Sistema',
          birthDate: new Date('1980-01-01'),
          profile: 'ADMIN',
          status: 'ACTIVE',
        },
      ],
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } });
  });

  it('conta so profile = STUDENT no groupBy entre tenants', async () => {
    const grupos = await comContexto({ kind: 'platform' }, () => repo.ativosPorTenant());

    expect(grupos.get(tenantId)).toBe(1);
  });
});
