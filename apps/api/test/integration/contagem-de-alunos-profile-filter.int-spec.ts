import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../../src/persistence/prisma.service.js';
import { contarAlunosDoTenant } from '../../src/modules/platform/contagem-de-alunos.js';

/**
 * `contarAlunosDoTenant` alimenta a fatura e o contrato (F64/F70) -- issue
 * #423, mesmo defeito da #413 (F81): sem filtro de `profile`, professor,
 * staff e admin entravam na base de cobranca do SaaS.
 */
describe('contarAlunosDoTenant filtra profile != STUDENT (issue #423)', () => {
  let db: PrismaService;
  let tenantId: string;
  let gymUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    db = moduleRef.get(PrismaService);

    tenantId = randomUUID();
    await db.tenant.create({
      data: {
        id: tenantId,
        slug: `f423a-${tenantId.slice(0, 8)}`,
        legalName: 'Tenant F423a LTDA',
        displayName: 'Tenant F423a',
      },
    });
    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: 'F423A',
        name: 'Unidade F423a',
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
          membershipNumber: 'F423A-0001',
          fullName: 'Aluno Ativo',
          birthDate: new Date('1995-01-01'),
          profile: 'STUDENT',
          status: 'ACTIVE',
        },
        {
          tenantId,
          gymUnitId,
          membershipNumber: 'F423A-0002',
          fullName: 'Aluno Inativo',
          birthDate: new Date('1994-01-01'),
          profile: 'STUDENT',
          status: 'CANCELLED',
        },
        {
          tenantId,
          gymUnitId,
          membershipNumber: 'F423A-0003',
          fullName: 'Professor Titular',
          birthDate: new Date('1985-01-01'),
          profile: 'TRAINER',
          status: 'ACTIVE',
        },
        {
          tenantId,
          gymUnitId,
          membershipNumber: 'F423A-0004',
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

  it('conta so profile = STUDENT, ativo e inativo por complemento', async () => {
    const contagem = await contarAlunosDoTenant(db, tenantId);

    expect(contagem.ativos).toBe(1);
    expect(contagem.inativos).toBe(1);
  });
});
