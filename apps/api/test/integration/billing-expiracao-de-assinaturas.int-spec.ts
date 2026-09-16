import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { ExpirarAssinaturasSchedulerService } from '../../src/modules/billing/expirar-assinaturas-scheduler.service.js';
import { ExpirarAssinaturasVencidasUseCase } from '../../src/modules/billing/expirar-assinaturas-vencidas.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Lacuna achada na investigacao da issue #272, apos o fix original (PR
 * #273) ja estar mergeado: nada expira uma `Subscription` `ACTIVE`/
 * `PAST_DUE` cujo `endsAt` ja passou. Contra banco de verdade (`docs/
 * TESTING.md` 3): a idempotencia e o filtro por estado de ORIGEM no
 * `updateMany`, e isso so se prova com o banco escrevendo de verdade.
 */
describe('ExpirarAssinaturasVencidasUseCase / ExpirarAssinaturasSchedulerService', () => {
  let db: PrismaService;
  let useCase: ExpirarAssinaturasVencidasUseCase;
  let scheduler: ExpirarAssinaturasSchedulerService;

  const sufixo = randomUUID().slice(0, 8);
  const tenantIdsCriados: string[] = [];

  const AGORA = new Date('2026-09-15T12:00:00.000Z');
  const VENCIDO = new Date('2026-08-01T00:00:00.000Z');
  const FUTURO = new Date('2026-12-01T00:00:00.000Z');

  async function semearAssinatura(status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED', endsAt: Date | null) {
    const rotulo = randomUUID().slice(0, 8);

    const tenant = await db.tenant.create({
      data: {
        slug: `f272-expira-${rotulo}-${sufixo}`,
        legalName: `F272 Expira ${rotulo} ${sufixo} LTDA`,
        displayName: `F272 Expira ${rotulo} ${sufixo}`,
      },
    });
    tenantIdsCriados.push(tenant.id);

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: `UNI-${rotulo}`,
        name: 'Unidade da fixture',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const plano = await db.plan.create({ data: { tenantId: tenant.id, name: `Plano ${rotulo}` } });

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        fullName: `Aluno ${rotulo}`,
        membershipNumber: `M-${rotulo}`,
        birthDate: new Date('1990-05-20T00:00:00Z'),
        status: 'ACTIVE',
      },
    });

    const assinatura = await db.subscription.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        planId: plano.id,
        status,
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt,
      },
    });

    return { tenantId: tenant.id, subscriptionId: assinatura.id };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    useCase = moduleRef.get(ExpirarAssinaturasVencidasUseCase);
    scheduler = moduleRef.get(ExpirarAssinaturasSchedulerService);
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: tenantIdsCriados.splice(0) } } });
  });

  it('expira ACTIVE com endsAt vencido', async () => {
    const s = await semearAssinatura('ACTIVE', VENCIDO);

    const resultado = await useCase.executar(s.tenantId, AGORA);
    expect(resultado.expiradas).toBe(1);

    const atualizada = await db.subscription.findUniqueOrThrow({ where: { id: s.subscriptionId } });
    expect(atualizada.status).toBe('EXPIRED');
  });

  it('expira PAST_DUE com endsAt vencido', async () => {
    const s = await semearAssinatura('PAST_DUE', VENCIDO);

    const resultado = await useCase.executar(s.tenantId, AGORA);
    expect(resultado.expiradas).toBe(1);

    const atualizada = await db.subscription.findUniqueOrThrow({ where: { id: s.subscriptionId } });
    expect(atualizada.status).toBe('EXPIRED');
  });

  it('nao toca ACTIVE com endsAt no futuro', async () => {
    const s = await semearAssinatura('ACTIVE', FUTURO);

    const resultado = await useCase.executar(s.tenantId, AGORA);
    expect(resultado.expiradas).toBe(0);

    const atualizada = await db.subscription.findUniqueOrThrow({ where: { id: s.subscriptionId } });
    expect(atualizada.status).toBe('ACTIVE');
  });

  it('nao toca ACTIVE sem endsAt (sem termino previsto)', async () => {
    const s = await semearAssinatura('ACTIVE', null);

    const resultado = await useCase.executar(s.tenantId, AGORA);
    expect(resultado.expiradas).toBe(0);

    const atualizada = await db.subscription.findUniqueOrThrow({ where: { id: s.subscriptionId } });
    expect(atualizada.status).toBe('ACTIVE');
  });

  it('nao toca CANCELLED, mesmo com endsAt vencido', async () => {
    const s = await semearAssinatura('CANCELLED', VENCIDO);

    const resultado = await useCase.executar(s.tenantId, AGORA);
    expect(resultado.expiradas).toBe(0);

    const atualizada = await db.subscription.findUniqueOrThrow({ where: { id: s.subscriptionId } });
    expect(atualizada.status).toBe('CANCELLED');
  });

  it('rodar duas vezes produz o mesmo resultado (idempotente por construcao)', async () => {
    const s = await semearAssinatura('ACTIVE', VENCIDO);

    const primeira = await useCase.executar(s.tenantId, AGORA);
    const segunda = await useCase.executar(s.tenantId, AGORA);

    expect(primeira.expiradas).toBe(1);
    expect(segunda.expiradas).toBe(0);
  });

  it('o scheduler varre todos os tenants ativos e expira a assinatura de cada um', async () => {
    const s1 = await semearAssinatura('ACTIVE', VENCIDO);
    const s2 = await semearAssinatura('PAST_DUE', VENCIDO);

    const resultado = await scheduler.executarCiclo(AGORA);

    expect(resultado.falhas).toBe(0);
    expect(resultado.expiradas).toBeGreaterThanOrEqual(2);

    const primeira = await db.subscription.findUniqueOrThrow({ where: { id: s1.subscriptionId } });
    const segunda = await db.subscription.findUniqueOrThrow({ where: { id: s2.subscriptionId } });
    expect(primeira.status).toBe('EXPIRED');
    expect(segunda.status).toBe('EXPIRED');
  });
});
