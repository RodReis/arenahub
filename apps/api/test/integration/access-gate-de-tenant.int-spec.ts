import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { AccessProjectionRepository } from '../../src/modules/access/access-projection.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F65 -- a projecao deriva o gate do status do tenant (ADR-053).
 *
 * O que este arquivo prova: `montarEntrada` le o status REAL do tenant no
 * banco e traduz para `tenant.gateActive`, sem depender de coluna propria.
 * Ampliado na Task 4 com o efeito de ponta a ponta na decisao de acesso.
 */
describe('F65 -- a projecao deriva o gate do status do tenant', () => {
  let app: INestApplication;
  let db: PrismaService;
  let projecao: AccessProjectionRepository;

  const sufixo = randomUUID().slice(0, 8);
  const agora = new Date('2026-09-09T12:00:00.000Z');

  let tenantId: string;
  let unidadeId: string;
  let alunoId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    projecao = app.get(AccessProjectionRepository);

    const tenant = await db.tenant.create({
      data: {
        slug: `f65-gate-${sufixo}`,
        legalName: 'Gate de Tenant LTDA',
        displayName: 'Gate de Tenant',
      },
    });

    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'CENTRO',
        name: 'Centro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    unidadeId = unidade.id;

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidadeId,
        membershipNumber: `GATE-${sufixo}`,
        fullName: 'Aluno Gate de Tenant',
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    alunoId = aluno.id;

    const entitlement = await db.entitlement.create({
      data: {
        tenantId: tenant.id,
        studentId: alunoId,
        source: 'SUBSCRIPTION',
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: new Date('2026-12-31T23:59:59.000Z'),
        policySnapshot: {},
      },
    });

    // Sete dias da semana, dia inteiro: o teste isola o gate do tenant, e
    // horario nao e a dimensao que ele quer provar.
    await db.entitlementUnitWindow.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({
        entitlementId: entitlement.id,
        gymUnitId: unidadeId,
        dayOfWeek: dia,
        startMinute: 0,
        endMinute: 1439,
      })),
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('tenant ACTIVE produz gateActive false', async () => {
    const entrada = await projecao.montarEntrada(tenantId, unidadeId, alunoId, 'ACTIVE', agora);

    expect(entrada.tenant.gateActive).toBe(false);
  });

  it('tenant SUSPENDED produz gateActive true', async () => {
    await db.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });

    const entrada = await projecao.montarEntrada(tenantId, unidadeId, alunoId, 'ACTIVE', agora);

    expect(entrada.tenant.gateActive).toBe(true);
  });

  it('tenant INACTIVE NAO fecha a catraca', async () => {
    /*
     * ADR-052 SS4: INACTIVE e o dono do SaaS desligando o cliente; o
     * ADR-053 fala so de inadimplencia. Colapsar os dois faria um
     * desligamento administrativo negar dizendo "suspensa por divida" --
     * mentira gravada num fato imutavel.
     */
    await db.tenant.update({ where: { id: tenantId }, data: { status: 'INACTIVE' } });

    const entrada = await projecao.montarEntrada(tenantId, unidadeId, alunoId, 'ACTIVE', agora);

    expect(entrada.tenant.gateActive).toBe(false);
  });
});
