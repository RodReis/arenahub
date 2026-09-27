import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { comContexto } from '@arenahub/database';

import { PrismaService } from '../../src/persistence/prisma.service.js';
import { TeamRepository } from '../../src/modules/team/team.repository.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';

describe('TeamRepository (F81)', () => {
  let repo: TeamRepository;
  let db: PrismaService;
  let tenantId: string;
  let gymUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [TeamRepository, PrismaService],
    }).compile();

    repo = moduleRef.get(TeamRepository);
    db = moduleRef.get(PrismaService);

    const sufixo = randomUUID().slice(0, 8);
    const tenant = await db.tenant.create({
      data: { slug: `team-${sufixo}`, legalName: `Team ${sufixo} LTDA`, displayName: `Team ${sufixo}` },
    });
    tenantId = tenant.id;
    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `TEAM-${sufixo}`,
        name: 'Unidade Team',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    gymUnitId = unidade.id;

    await db.student.createMany({
      data: [
        { tenantId, gymUnitId, membershipNumber: 'TEAM-0001', fullName: 'Aluno Fora', birthDate: new Date('1995-01-01'), profile: 'STUDENT' },
        { tenantId, gymUnitId, membershipNumber: 'TEAM-0002', fullName: 'Professor A', birthDate: new Date('1985-01-01'), profile: 'TRAINER' },
        { tenantId, gymUnitId, membershipNumber: 'TEAM-0003', fullName: 'Staff B', birthDate: new Date('1988-01-01'), profile: 'STAFF' },
        { tenantId, gymUnitId, membershipNumber: 'TEAM-0004', fullName: 'Admin C', birthDate: new Date('1980-01-01'), profile: 'ADMIN' },
      ],
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } });
  });

  it('buscar() devolve so profile != STUDENT', async () => {
    const membros = await comContexto({ kind: 'system', tenantId }, () =>
      repo.buscar({ tenantId } as TenantContext, { limite: 20 }),
    );
    expect(membros).toHaveLength(3);
    expect(membros.map((m) => m.fullName).sort()).toEqual(['Admin C', 'Professor A', 'Staff B']);
  });

  it('contar() bate com buscar()', async () => {
    const total = await comContexto({ kind: 'system', tenantId }, () =>
      repo.contar({ tenantId } as TenantContext, {}),
    );
    expect(total).toBe(3);
  });

  it('busca por termo filtra pelo nome', async () => {
    const membros = await comContexto({ kind: 'system', tenantId }, () =>
      repo.buscar({ tenantId } as TenantContext, { termo: 'Professor', limite: 20 }),
    );
    expect(membros).toHaveLength(1);
    expect(membros[0]?.fullName).toBe('Professor A');
  });

  it('encontrar() devolve null para id de outro tenant', async () => {
    const sufixoOutro = randomUUID().slice(0, 8);
    const outroTenant = await db.tenant.create({
      data: { slug: `outro-${sufixoOutro}`, legalName: `Outro ${sufixoOutro} LTDA`, displayName: `Outro ${sufixoOutro}` },
    });
    const outroTenantId = outroTenant.id;
    const outraUnidade = await db.gymUnit.create({
      data: {
        tenantId: outroTenantId,
        code: `OUTRO-${sufixoOutro}`,
        name: 'U',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    const alheio = await db.student.create({
      data: { tenantId: outroTenantId, gymUnitId: outraUnidade.id, membershipNumber: 'X-0001', fullName: 'Alheio', birthDate: new Date('1990-01-01'), profile: 'TRAINER' },
    });

    const resultado = await comContexto({ kind: 'system', tenantId }, () =>
      repo.encontrar({ tenantId } as TenantContext, alheio.id),
    );
    expect(resultado).toBeNull();

    await db.tenant.delete({ where: { id: outroTenantId } });
  });

  it('atualizarVinculo grava employmentType e registra timeline/audit/outbox', async () => {
    const professor = await db.student.create({
      data: { tenantId, gymUnitId, membershipNumber: 'TEAM-0010', fullName: 'Professor Vinculo', birthDate: new Date('1985-01-01'), profile: 'TRAINER' },
    });

    const atualizado = await comContexto({ kind: 'system', tenantId }, () =>
      repo.atualizarVinculo(
        { tenantId } as never,
        professor.id,
        0,
        { employmentType: 'CLT', employmentStartedAt: new Date('2024-03-01') },
        'corr-f81-teste',
      ),
    );

    expect(atualizado?.employmentType).toBe('CLT');
    expect(atualizado?.version).toBe(1);

    const timeline = await db.studentTimelineEvent.findFirst({ where: { studentId: professor.id, type: 'STUDENT_UPDATED' } });
    expect(timeline).not.toBeNull();

    const outbox = await db.outboxEvent.findFirst({ where: { aggregateId: professor.id, eventType: 'StudentUpdated' } });
    expect(outbox).not.toBeNull();
  });

  it('atualizarVinculo devolve null quando version nao bata', async () => {
    const professor = await db.student.create({
      data: { tenantId, gymUnitId, membershipNumber: 'TEAM-0011', fullName: 'Professor Versao', birthDate: new Date('1985-01-01'), profile: 'TRAINER' },
    });

    const resultado = await comContexto({ kind: 'system', tenantId }, () =>
      repo.atualizarVinculo({ tenantId } as never, professor.id, 99, { employmentType: 'PJ' }, 'corr-f81-teste-2'),
    );

    expect(resultado).toBeNull();
  });

  it('atualizarVinculo devolve null para Student com profile STUDENT', async () => {
    const aluno = await db.student.create({
      data: { tenantId, gymUnitId, membershipNumber: 'TEAM-0012', fullName: 'Aluno Nao Time', birthDate: new Date('1995-01-01'), profile: 'STUDENT' },
    });

    const resultado = await comContexto({ kind: 'system', tenantId }, () =>
      repo.atualizarVinculo({ tenantId } as never, aluno.id, 0, { employmentType: 'CLT' }, 'corr-f81-teste-3'),
    );

    expect(resultado).toBeNull();
  });
});
