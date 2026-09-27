import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { comContexto } from '@arenahub/database';

import { PrismaService } from '../../src/persistence/prisma.service.js';
import { TeamRepository } from '../../src/modules/team/team.repository.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';

describe('TeamRepository.buscarAgenda (F81)', () => {
  let repo: TeamRepository;
  let db: PrismaService;
  let tenantId: string;
  let gymUnitId: string;
  let modalityId: string;
  let trainerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [TeamRepository, PrismaService],
    }).compile();

    repo = moduleRef.get(TeamRepository);
    db = moduleRef.get(PrismaService);

    const sufixo = randomUUID().slice(0, 8);
    const tenant = await db.tenant.create({
      data: { slug: `agenda-${sufixo}`, legalName: `Agenda ${sufixo} LTDA`, displayName: `Agenda ${sufixo}` },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `AGENDA-${sufixo}`,
        name: 'Unidade Agenda',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    gymUnitId = unidade.id;

    const modalidade = await db.gymUnitModality.create({
      data: { tenantId, gymUnitId, name: 'Cross Fit' },
    });
    modalityId = modalidade.id;

    const professor = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: 'AGENDA-0001',
        fullName: 'Professor Agenda',
        birthDate: new Date('1985-01-01'),
        profile: 'TRAINER',
      },
    });
    trainerId = professor.id;

    await db.class.createMany({
      data: [
        {
          tenantId,
          gymUnitId,
          modalityId,
          trainerId,
          dayOfWeek: 1,
          startMinute: 420,
          durationMinutes: 60,
          capacity: 20,
        },
        {
          tenantId,
          gymUnitId,
          modalityId,
          trainerId,
          dayOfWeek: 3,
          startMinute: 420,
          durationMinutes: 60,
          capacity: 20,
        },
        {
          tenantId,
          gymUnitId,
          modalityId,
          trainerId: null,
          dayOfWeek: 5,
          startMinute: 600,
          durationMinutes: 60,
          capacity: 15,
        },
      ],
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } });
  });

  it('devolve so as aulas deste professor', async () => {
    const agenda = await comContexto({ kind: 'system', tenantId }, () =>
      repo.buscarAgenda({ tenantId } as TenantContext, trainerId),
    );
    expect(agenda).toHaveLength(2);
    expect(agenda.map((a) => a.dayOfWeek).sort()).toEqual([1, 3]);
  });

  it('devolve lista vazia para professor sem aula', async () => {
    const outroProfessor = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: 'AGENDA-0002',
        fullName: 'Professor Sem Aula',
        birthDate: new Date('1985-01-01'),
        profile: 'TRAINER',
      },
    });

    const agenda = await comContexto({ kind: 'system', tenantId }, () =>
      repo.buscarAgenda({ tenantId } as TenantContext, outroProfessor.id),
    );
    expect(agenda).toHaveLength(0);
  });

  it('nao vaza agenda de professor de outro tenant', async () => {
    const sufixoOutro = randomUUID().slice(0, 8);
    const outroTenantData = await db.tenant.create({
      data: {
        slug: `outro-agenda-${sufixoOutro}`,
        legalName: `Outro Agenda ${sufixoOutro} LTDA`,
        displayName: `Outro Agenda ${sufixoOutro}`,
      },
    });
    const outroTenantId = outroTenantData.id;

    const outraUnidade = await db.gymUnit.create({
      data: {
        tenantId: outroTenantId,
        code: `OUTRA-${sufixoOutro}`,
        name: 'U2',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const outraModalidade = await db.gymUnitModality.create({
      data: { tenantId: outroTenantId, gymUnitId: outraUnidade.id, name: 'Outra' },
    });

    const professorAlheio = await db.student.create({
      data: {
        tenantId: outroTenantId,
        gymUnitId: outraUnidade.id,
        membershipNumber: 'ALHEIO-0001',
        fullName: 'Professor Alheio',
        birthDate: new Date('1985-01-01'),
        profile: 'TRAINER',
      },
    });

    await db.class.create({
      data: {
        tenantId: outroTenantId,
        gymUnitId: outraUnidade.id,
        modalityId: outraModalidade.id,
        trainerId: professorAlheio.id,
        dayOfWeek: 2,
        startMinute: 480,
        durationMinutes: 60,
        capacity: 10,
      },
    });

    // Contexto do TENANT ERRADO (o do describe), id do professor de outro tenant.
    const agenda = await comContexto({ kind: 'system', tenantId }, () =>
      repo.buscarAgenda({ tenantId } as TenantContext, professorAlheio.id),
    );
    expect(agenda).toHaveLength(0);

    await db.tenant.delete({ where: { id: outroTenantId } });
  });
});
