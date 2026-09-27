import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPrismaClient, type PrismaClientArenaHub } from '../src/index.js';

describe('vinculo trabalhista do time (F81)', () => {
  let db: PrismaClientArenaHub;
  let tenantId: string;
  let gymUnitId: string;

  beforeAll(async () => {
    db = criarPrismaClient();
    const sufixo = randomUUID().slice(0, 8);
    const tenant = await db.tenant.create({
      data: {
        slug: `f81-${sufixo}`,
        legalName: 'Tenant F81 Legal',
        displayName: 'Tenant F81',
      }
    });
    tenantId = tenant.id;
    const unidade = await db.gymUnit.create({
      data: { tenantId, code: 'F81', name: 'Unidade F81', timezone: 'America/Sao_Paulo', openingHours: {} },
    });
    gymUnitId = unidade.id;
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } });
    await db.$disconnect();
  });

  it('grava employmentType e employmentStartedAt para profile != STUDENT', async () => {
    const professor = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: 'F81-0001',
        fullName: 'Professor Teste F81',
        birthDate: new Date('1990-01-01'),
        profile: 'TRAINER',
        employmentType: 'CLT',
        employmentStartedAt: new Date('2024-01-01'),
      },
    });

    expect(professor.employmentType).toBe('CLT');
    expect(professor.employmentStartedAt?.toISOString()).toContain('2024-01-01');
  });

  it('aluno comum fica com employmentType null por padrao', async () => {
    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: 'F81-0002',
        fullName: 'Aluno Teste F81',
        birthDate: new Date('1995-01-01'),
      },
    });

    expect(aluno.employmentType).toBeNull();
    expect(aluno.employmentStartedAt).toBeNull();
  });
});
