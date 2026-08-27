import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F31, Task 1 -- o modelo de dados do ledger de XP, conquistas e
 * ranking, contra Postgres real.
 *
 * O que este arquivo prova, e que nenhum dublê alcança:
 *
 *   - a chave unica que garante `M5-AC-002` -- cem replays do mesmo fato
 *     colidem numa linha so, tratados como sucesso idempotente no service,
 *     nao como erro de retry infinito;
 *   - o ledger e append-only DE VERDADE: o trigger no banco recusa UPDATE e
 *     DELETE, nao so a disciplina da aplicacao.
 */
describe('F31 -- XP, conquistas e ranking (integracao)', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);

  let tenantId = '';
  let gymUnitId = '';
  let studentId = '';
  let ruleVersionId = '';
  let contadorDeMatricula = 0;

  const criarAluno = async (): Promise<string> => {
    contadorDeMatricula += 1;

    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: `F31-${sufixo}-${String(contadorDeMatricula).padStart(4, '0')}`,
        fullName: 'Aluno De Teste Do F31',
        birthDate: new Date('1995-06-15T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    return aluno.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `f31-tenant-${sufixo}`,
        legalName: `F31 ${sufixo} LTDA`,
        displayName: `F31 ${sufixo}`,
      },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: 'CENTRO',
        name: `Centro ${sufixo}`,
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    gymUnitId = unidade.id;

    studentId = await criarAluno();

    const regra = await db.xpRuleVersion.create({
      data: {
        tenantId,
        code: 'treino-diario',
        version: 1,
        trigger: 'SESSAO_CONFIRMADA',
        points: 10,
        status: 'APPROVED',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    ruleVersionId = regra.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('recusa dois movimentos identicos para o mesmo fato', async () => {
    const sessionId = randomUUID();
    const chave = {
      tenantId,
      studentId,
      sourceKind: 'ATTENDANCE_SESSION' as const,
      sourceId: sessionId,
      ruleVersionId,
      type: 'GRANT' as const,
    };

    await db.xpLedgerEntry.create({
      data: { ...chave, points: 10, occurredAt: new Date('2026-08-10T12:00:00Z'), localMonth: '2026-08' },
    });

    await expect(
      db.xpLedgerEntry.create({
        data: { ...chave, points: 10, occurredAt: new Date('2026-08-10T12:00:00Z'), localMonth: '2026-08' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('recusa UPDATE e DELETE no ledger', async () => {
    const entrada = await db.xpLedgerEntry.create({
      data: {
        tenantId,
        studentId,
        sourceKind: 'ATTENDANCE_SESSION',
        sourceId: randomUUID(),
        ruleVersionId,
        type: 'GRANT',
        points: 10,
        occurredAt: new Date('2026-08-11T12:00:00Z'),
        localMonth: '2026-08',
      },
    });

    await expect(
      db.xpLedgerEntry.update({ where: { id: entrada.id }, data: { points: 999 } }),
    ).rejects.toThrow(/XP_LEDGER_APPEND_ONLY/u);

    await expect(
      db.xpLedgerEntry.delete({ where: { id: entrada.id } }),
    ).rejects.toThrow(/XP_LEDGER_APPEND_ONLY/u);
  });
});
