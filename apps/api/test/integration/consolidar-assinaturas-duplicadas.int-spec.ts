import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { MembershipRepository } from '../../src/modules/membership/membership.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Integracao da consolidacao de assinaturas duplicadas (issue #390) contra
 * Postgres de verdade -- o que o unitario de `dominio.ts` nao prova: a
 * MIGRACAO real do `subscriptionId` do entitlement, e que ela NUNCA passa
 * por `REVOKED` no caminho (o `status` fica `ACTIVE` do inicio ao fim da
 * transacao).
 *
 * Nenhum dado real de aluno (`CLAUDE.md`): nomes inventados, tenant proprio
 * por sufixo aleatorio.
 */
describe('MembershipRepository.consolidarAssinaturaDuplicada (issue #390)', () => {
  let app: INestApplication;
  let db: PrismaService;
  const sufixo = randomUUID().slice(0, 8);

  let tenantId: string;
  let actorId: string;
  let gymUnitId: string;
  let planId: string;

  const AGORA = new Date('2026-09-24T12:00:00Z');

  function contexto(): TenantContext {
    return {
      tenantId,
      actorId,
      sessionId: randomUUID(),
      permissions: new Set(),
      allowedUnitIds: 'ALL',
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `consolida-${sufixo}`,
        legalName: `Academia Consolida Teste ${sufixo} LTDA`,
        displayName: `Academia Consolida Teste ${sufixo}`,
      },
    });
    tenantId = tenant.id;

    const operador = await db.user.create({
      data: { email: `op-consolida-${sufixo}@arena.test`, passwordHash: 'x'.repeat(60) },
    });
    actorId = operador.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `UNI-${sufixo}`,
        name: 'Unidade da fixture',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const plano = await db.plan.create({ data: { tenantId, name: `Plano ${sufixo}` } });
    planId = plano.id;
    gymUnitId = unidade.id;
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await db.user.delete({ where: { id: actorId } }).catch(() => undefined);
    await app.close();
  });

  /**
   * Cria um aluno NOVO (indice parcial `subscriptions_uma_vigente_por_aluno`
   * recusa duas ACTIVE/PAST_DUE do mesmo aluno -- issue #272 -- entao cada
   * cenario de teste precisa do proprio aluno) com uma assinatura
   * sobrevivente ACTIVE e uma assinatura a encerrar, com entitlement
   * opcional nesta ultima.
   */
  async function criarCenario(opcoes: {
    statusDaEncerrada: 'ACTIVE' | 'CANCELLED' | 'EXPIRED';
    entitlementStatus?: 'ACTIVE' | 'REVOKED';
    entitlementValidoAgora?: boolean;
  }): Promise<{ studentId: string; subscriptionId: string; entitlementId?: string; sobreviventeId: string }> {
    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        fullName: `Aluno Consolida ${sufixo} ${randomUUID().slice(0, 6)}`,
        membershipNumber: `M-${sufixo}-${randomUUID().slice(0, 6)}`,
        birthDate: new Date('1990-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
    });

    const sobrevivente = await db.subscription.create({
      data: { tenantId, studentId: aluno.id, planId, status: 'ACTIVE', startsAt: AGORA },
    });

    const assinatura = await db.subscription.create({
      data: { tenantId, studentId: aluno.id, planId, status: opcoes.statusDaEncerrada, startsAt: AGORA },
    });

    if (!opcoes.entitlementStatus) {
      return { studentId: aluno.id, subscriptionId: assinatura.id, sobreviventeId: sobrevivente.id };
    }

    const entitlement = await db.entitlement.create({
      data: {
        tenantId,
        studentId: aluno.id,
        subscriptionId: assinatura.id,
        source: 'SUBSCRIPTION',
        status: opcoes.entitlementStatus,
        startsAt: opcoes.entitlementValidoAgora === false ? new Date('2026-01-01T00:00:00Z') : new Date('2026-09-01T00:00:00Z'),
        endsAt: opcoes.entitlementValidoAgora === false ? new Date('2026-02-01T00:00:00Z') : new Date('2026-10-01T00:00:00Z'),
        policySnapshot: {},
      },
    });

    return {
      studentId: aluno.id,
      subscriptionId: assinatura.id,
      entitlementId: entitlement.id,
      sobreviventeId: sobrevivente.id,
    };
  }

  it('MIGRA o entitlement -- fica ACTIVE, muda de subscriptionId, nunca passa por REVOKED', async () => {
    const cenario = await criarCenario({
      statusDaEncerrada: 'EXPIRED',
      entitlementStatus: 'ACTIVE',
      entitlementValidoAgora: true,
    });
    const encerrada = { subscriptionId: cenario.subscriptionId, entitlementId: cenario.entitlementId };
    const sobrevivente = { subscriptionId: cenario.sobreviventeId };

    const membership = app.get(MembershipRepository);

    await membership.consolidarAssinaturaDuplicada(
      contexto(),
      {
        assinaturaId: encerrada.subscriptionId,
        sobreviventeId: sobrevivente.subscriptionId,
        entitlementParaMigrarId: encerrada.entitlementId!,
        reason: 'teste de migracao',
      },
      randomUUID(),
      AGORA,
    );

    const assinaturaEncerrada = await db.subscription.findUniqueOrThrow({
      where: { id: encerrada.subscriptionId },
    });
    expect(assinaturaEncerrada.status).toBe('CANCELLED');

    const entitlementMigrado = await db.entitlement.findUniqueOrThrow({
      where: { id: encerrada.entitlementId! },
    });
    expect(entitlementMigrado.status).toBe('ACTIVE');
    expect(entitlementMigrado.subscriptionId).toBe(sobrevivente.subscriptionId);
    expect(entitlementMigrado.revokedAt).toBeNull();
  });

  it('REVOGA quando nao ha entitlement para migrar -- comportamento normal', async () => {
    const cenario = await criarCenario({
      statusDaEncerrada: 'CANCELLED',
      entitlementStatus: 'ACTIVE',
      entitlementValidoAgora: false, // vencido -- nao e risco, revoga normal
    });
    const encerrada = { subscriptionId: cenario.subscriptionId, entitlementId: cenario.entitlementId };
    const sobrevivente = { subscriptionId: cenario.sobreviventeId };

    const membership = app.get(MembershipRepository);

    await membership.consolidarAssinaturaDuplicada(
      contexto(),
      {
        assinaturaId: encerrada.subscriptionId,
        sobreviventeId: sobrevivente.subscriptionId,
        entitlementParaMigrarId: null,
        reason: 'teste de revogacao normal',
      },
      randomUUID(),
      AGORA,
    );

    const entitlementRevogado = await db.entitlement.findUniqueOrThrow({
      where: { id: encerrada.entitlementId! },
    });
    expect(entitlementRevogado.status).toBe('REVOKED');
    expect(entitlementRevogado.revokedAt).toEqual(AGORA);
    // Continua ligado a assinatura ORIGINAL -- so o status muda.
    expect(entitlementRevogado.subscriptionId).toBe(encerrada.subscriptionId);
  });

  it('grava timeline e auditLog com o rastro da consolidacao', async () => {
    const cenario = await criarCenario({ statusDaEncerrada: 'CANCELLED' });
    const encerrada = { subscriptionId: cenario.subscriptionId };
    const sobrevivente = { subscriptionId: cenario.sobreviventeId };

    const membership = app.get(MembershipRepository);
    const correlationId = randomUUID();

    await membership.consolidarAssinaturaDuplicada(
      contexto(),
      {
        assinaturaId: encerrada.subscriptionId,
        sobreviventeId: sobrevivente.subscriptionId,
        entitlementParaMigrarId: null,
        reason: 'teste de auditoria',
      },
      correlationId,
      AGORA,
    );

    const auditoria = await db.auditLog.findFirst({
      where: { tenantId, targetId: encerrada.subscriptionId, action: 'membership.subscription.consolidated' },
    });
    expect(auditoria).not.toBeNull();
    expect(auditoria?.correlationId).toBe(correlationId);

    const timeline = await db.studentTimelineEvent.findFirst({
      where: { tenantId, studentId: cenario.studentId, correlationId },
    });
    expect(timeline?.type).toBe('SUBSCRIPTION_CANCELLED');
  });

  it('lanca erro de dominio para assinatura inexistente -- nao silencia', async () => {
    const cenario = await criarCenario({ statusDaEncerrada: 'CANCELLED' });
    const membership = app.get(MembershipRepository);

    await expect(
      membership.consolidarAssinaturaDuplicada(
        contexto(),
        {
          assinaturaId: randomUUID(),
          sobreviventeId: cenario.sobreviventeId,
          entitlementParaMigrarId: null,
          reason: 'nao deveria achar',
        },
        randomUUID(),
        AGORA,
      ),
    ).rejects.toThrow();
  });

  it('tenant A nao consolida assinatura do tenant B', async () => {
    const outroTenant = await db.tenant.create({
      data: { slug: `outro-consolida-${sufixo}`, legalName: 'Outro LTDA', displayName: 'Outro' },
    });

    try {
      const outraUnidade = await db.gymUnit.create({
        data: { tenantId: outroTenant.id, code: 'U1', name: 'U1', timezone: 'America/Sao_Paulo', openingHours: {} },
      });
      const outroPlano = await db.plan.create({ data: { tenantId: outroTenant.id, name: 'Plano B' } });
      const outroAluno = await db.student.create({
        data: {
          tenantId: outroTenant.id,
          gymUnitId: outraUnidade.id,
          fullName: 'Aluno B',
          membershipNumber: `MB-${sufixo}`,
          birthDate: new Date('1990-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
      const assinaturaDoB = await db.subscription.create({
        data: { tenantId: outroTenant.id, studentId: outroAluno.id, planId: outroPlano.id, status: 'CANCELLED', startsAt: AGORA },
      });

      const cenario = await criarCenario({ statusDaEncerrada: 'CANCELLED' });
      const membership = app.get(MembershipRepository);

      await expect(
        membership.consolidarAssinaturaDuplicada(
          contexto(), // contexto do tenant A
          {
            assinaturaId: assinaturaDoB.id,
            sobreviventeId: cenario.sobreviventeId,
            entitlementParaMigrarId: null,
            reason: 'cross-tenant',
          },
          randomUUID(),
          AGORA,
        ),
      ).rejects.toThrow();
    } finally {
      await db.tenant.delete({ where: { id: outroTenant.id } }).catch(() => undefined);
    }
  });
});
