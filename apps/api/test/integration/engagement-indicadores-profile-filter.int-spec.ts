import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { comContexto } from '@arenahub/database';

import { PrismaService } from '../../src/persistence/prisma.service.js';
import { EngagementRepository } from '../../src/modules/engagement/engagement.repository.js';

/**
 * `indicadores()` alimenta o painel de engajamento (`M5-FR-018`) -- issue
 * #423, mesmo defeito da #413 (F81): sem filtro de `profile`, professor,
 * staff e admin somavam em `alunosAtivos`, inflando tambem
 * `participandoDoRanking` (que deriva por subtracao do mesmo numero).
 */
describe('EngagementRepository.indicadores filtra profile != STUDENT (issue #423)', () => {
  let repo: EngagementRepository;
  let db: PrismaService;
  let tenantId: string;
  let gymUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EngagementRepository, PrismaService],
    }).compile();

    repo = moduleRef.get(EngagementRepository);
    db = moduleRef.get(PrismaService);

    tenantId = randomUUID();
    await db.tenant.create({
      data: {
        id: tenantId,
        slug: `f423b-${tenantId.slice(0, 8)}`,
        legalName: 'Tenant F423b LTDA',
        displayName: 'Tenant F423b',
      },
    });
    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: 'F423B',
        name: 'Unidade F423b',
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
          membershipNumber: 'F423B-0001',
          fullName: 'Aluno Ativo',
          birthDate: new Date('1995-01-01'),
          profile: 'STUDENT',
          status: 'ACTIVE',
        },
        {
          tenantId,
          gymUnitId,
          membershipNumber: 'F423B-0002',
          fullName: 'Professor Titular',
          birthDate: new Date('1985-01-01'),
          profile: 'TRAINER',
          status: 'ACTIVE',
        },
        {
          tenantId,
          gymUnitId,
          membershipNumber: 'F423B-0003',
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

  it('alunosAtivos conta so profile = STUDENT', async () => {
    const indicadores = await comContexto({ kind: 'system', tenantId }, () =>
      repo.indicadores(tenantId),
    );

    expect(indicadores.alunosAtivos).toBe(1);
    expect(indicadores.participandoDoRanking).toBe(1);
  });
});
