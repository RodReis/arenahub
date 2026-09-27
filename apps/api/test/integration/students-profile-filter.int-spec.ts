import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { comContexto } from '@arenahub/database';

import { PrismaService } from '../../src/persistence/prisma.service.js';
import { StudentRepository } from '../../src/modules/students/student.repository.js';

describe('StudentRepository filtra profile != STUDENT (F81, issue #413)', () => {
  let repo: StudentRepository;
  let db: PrismaService;
  let tenantId: string;
  let gymUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [StudentRepository, PrismaService],
    }).compile();

    repo = moduleRef.get(StudentRepository);
    db = moduleRef.get(PrismaService);

    tenantId = randomUUID();
    await db.tenant.create({
      data: {
        id: tenantId,
        slug: `f81b-${tenantId.slice(0, 8)}`,
        legalName: 'Tenant F81b LTDA',
        displayName: 'Tenant F81b',
      },
    });
    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: 'F81B',
        name: 'Unidade F81b',
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
          membershipNumber: 'F81B-0001',
          fullName: 'Aluno Comum',
          birthDate: new Date('1995-01-01'),
          profile: 'STUDENT',
        },
        {
          tenantId,
          gymUnitId,
          membershipNumber: 'F81B-0002',
          fullName: 'Professor Titular',
          birthDate: new Date('1985-01-01'),
          profile: 'TRAINER',
        },
        {
          tenantId,
          gymUnitId,
          membershipNumber: 'F81B-0003',
          fullName: 'Admin Sistema',
          birthDate: new Date('1980-01-01'),
          profile: 'ADMIN',
        },
      ],
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } });
  });

  it('contar() so conta profile = STUDENT', async () => {
    const total = await comContexto({ kind: 'system', tenantId }, () => repo.contar({ tenantId } as never, {}));
    expect(total).toBe(1);
  });

  it('buscar() so devolve profile = STUDENT', async () => {
    const resultado = await comContexto({ kind: 'system', tenantId }, () =>
      repo.buscar({ tenantId } as never, { limite: 20 }, new Date()),
    );
    expect(resultado).toHaveLength(1);
    expect(resultado[0]?.fullName).toBe('Aluno Comum');
  });
});
