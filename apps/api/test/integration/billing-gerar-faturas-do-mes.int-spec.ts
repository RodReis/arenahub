import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import { BillingRepository } from '../../src/modules/billing/billing.repository.js';
import { GerarFaturasDoMesSchedulerService } from '../../src/modules/billing/gerar-faturas-do-mes-scheduler.service.js';
import { GerarFaturasDoMesUseCase } from '../../src/modules/billing/gerar-faturas-do-mes.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F88 -- fatura do mes gerada todo dia 01 para o aluno que depende de plano.
 *
 * Contra banco de verdade (`docs/TESTING.md` 3): a elegibilidade passa por
 * `students`, que tem RLS, e a idempotencia e o indice unico de INV-066.
 *
 * O tenant e compartilhado pelos tres casos, entao cada um usa uma COMPETENCIA
 * propria (nov, dez, jan) e todo aluno nasce com matricula unica.
 */
describe('GerarFaturasDoMesUseCase', () => {
  let moduleRef: TestingModule;
  let db: PrismaService;
  let gerar: GerarFaturasDoMesUseCase;

  const sufixo = randomUUID().slice(0, 8);
  let tenantId = '';
  let unidadeId = '';
  let planoMensalId = '';
  let planoDiariaId = '';
  let contador = 0;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    gerar = comContextoDeTenant(moduleRef.get(GerarFaturasDoMesUseCase));

    const tenant = await db.tenant.create({
      data: {
        slug: `gfm-${sufixo}`,
        legalName: `Gerar Faturas ${sufixo} LTDA`,
        displayName: `Gerar Faturas ${sufixo}`,
      },
    });
    tenantId = tenant.id;

    await db.billingSettings.create({ data: { tenantId, dueDay: 10, graceDays: 5 } });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: 'SP',
        name: 'Sao Paulo',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    unidadeId = unidade.id;

    const preco = {
      create: [
        { tenantId, amountMinor: 10000, currency: 'BRL', validFrom: new Date('2026-01-01T00:00:00Z') },
      ],
    };
    const mensal = await db.plan.create({
      data: { tenantId, name: `Mensal ${sufixo}`, billingMode: 'AVULSO', prices: preco },
      select: { id: true },
    });
    const diaria = await db.plan.create({
      data: { tenantId, name: `Diaria ${sufixo}`, billingMode: 'DIARIA', prices: preco },
      select: { id: true },
    });
    planoMensalId = mensal.id;
    planoDiariaId = diaria.id;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: tenantId } });
    await moduleRef.close();
  });

  /** Aluno + assinatura; os padroes descrevem o aluno ELEGIVEL. */
  async function aluno(opcoes: {
    profile?: 'STUDENT' | 'STAFF';
    status?: 'ACTIVE' | 'SUSPENDED';
    billingMode?: 'AVULSO' | 'DIARIA';
    statusAssinatura?: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
    startsAt?: Date;
    endsAt?: Date;
  }): Promise<{ studentId: string; subscriptionId: string }> {
    contador += 1;
    const estudante = await db.student.create({
      data: {
        tenantId,
        gymUnitId: unidadeId,
        membershipNumber: `GFM-${sufixo}-${contador}`,
        fullName: `Aluno GFM ${contador}`,
        birthDate: new Date('2000-01-01T00:00:00Z'),
        profile: opcoes.profile ?? 'STUDENT',
        status: opcoes.status ?? 'ACTIVE',
      },
      select: { id: true },
    });

    const assinatura = await db.subscription.create({
      data: {
        tenantId,
        studentId: estudante.id,
        planId: opcoes.billingMode === 'DIARIA' ? planoDiariaId : planoMensalId,
        status: opcoes.statusAssinatura ?? 'ACTIVE',
        startsAt: opcoes.startsAt ?? new Date('2026-01-01T00:00:00Z'),
        endsAt: opcoes.endsAt ?? null,
      },
      select: { id: true },
    });

    return { studentId: estudante.id, subscriptionId: assinatura.id };
  }

  it('cria a fatura da competencia so para STUDENT ATIVO com assinatura vigente e plano mensal', async () => {
    const elegivel = await aluno({});
    const atrasado = await aluno({ statusAssinatura: 'PAST_DUE' });
    await aluno({ profile: 'STAFF' });
    await aluno({ status: 'SUSPENDED' });
    await aluno({ billingMode: 'DIARIA' });
    await aluno({ statusAssinatura: 'CANCELLED' });

    const r = await gerar.executar(tenantId, new Date('2026-11-01T03:05:00Z'));

    expect(r).toEqual({ elegiveis: 2, criadas: 2, jaExistiam: 0, falhas: 0 });
    const faturas = await db.invoice.findMany({
      where: { tenantId, billingPeriod: new Date('2026-11-01T00:00:00Z') },
    });
    expect(faturas.map((f) => f.subscriptionId).sort()).toEqual(
      [elegivel.subscriptionId, atrasado.subscriptionId].sort(),
    );
    expect(faturas.every((f) => f.dueAt.toISOString() === '2026-11-10T00:00:00.000Z')).toBe(true);
    expect(faturas.every((f) => f.blockAt!.toISOString() === '2026-11-15T03:00:00.000Z')).toBe(true);
  });

  it('rodar duas vezes nao duplica nem consome numero', async () => {
    await aluno({});
    const primeira = await gerar.executar(tenantId, new Date('2026-12-01T03:05:00Z'));
    const total = await db.invoice.count({ where: { tenantId } });
    const sequenciaAntes = await db.invoiceSequence.findUnique({ where: { tenantId } });

    const segunda = await gerar.executar(tenantId, new Date('2026-12-01T03:06:00Z'));

    expect(primeira.criadas).toBe(primeira.elegiveis);
    expect(segunda.criadas).toBe(0);
    expect(segunda.jaExistiam).toBe(primeira.elegiveis);
    expect(segunda.falhas).toBe(0);
    expect(await db.invoice.count({ where: { tenantId } })).toBe(total);
    expect(await db.invoiceSequence.findUnique({ where: { tenantId } })).toEqual(sequenciaAntes);
  });

  it('respeita a vigencia: contrato que acabou na virada ou que so comeca depois nao recebe fatura', async () => {
    // fev/2027, 00:05 em Sao Paulo
    const virada = new Date('2027-02-01T03:05:00Z');
    const terminouNaVirada = await aluno({ endsAt: new Date('2027-02-01T03:00:00Z') });
    const terminaDepois = await aluno({ endsAt: new Date('2027-03-01T03:00:00Z') });
    const comecaEmMesFuturo = await aluno({ startsAt: new Date('2027-03-15T12:00:00Z') });
    const comecaNoMes = await aluno({ startsAt: new Date('2027-02-20T12:00:00Z') });

    await gerar.executar(tenantId, virada);

    const geradas = new Set(
      (
        await db.invoice.findMany({
          where: { tenantId, billingPeriod: new Date('2027-02-01T00:00:00Z') },
          select: { subscriptionId: true },
        })
      ).map((i) => i.subscriptionId),
    );
    expect(geradas.has(terminouNaVirada.subscriptionId)).toBe(false);
    expect(geradas.has(comecaEmMesFuturo.subscriptionId)).toBe(false);
    expect(geradas.has(terminaDepois.subscriptionId)).toBe(true);
    expect(geradas.has(comecaNoMes.subscriptionId)).toBe(true);
  });

  it('o scheduler abre o proprio contexto de tenant (sem requisicao)', async () => {
    const novo = await aluno({});
    // Restringe ao tenant do cenario: o ciclo real varre todos e geraria fatura
    // em dado de outra suite no mesmo banco. O `comContexto` interno -- o que se
    // prova aqui -- continua sendo o do scheduler.
    jest.spyOn(moduleRef.get(BillingRepository), 'listarTenantsAtivos').mockResolvedValue([tenantId]);

    try {
      // Sem `comContextoDeTenant`: nenhum contexto de requisicao aberto.
      const r = await moduleRef
        .get(GerarFaturasDoMesSchedulerService)
        .executarCiclo(new Date('2027-01-01T03:05:00Z'));

      expect(r.tenants).toBe(1);
      expect(r.falhas).toBe(0);
      expect(r.criadas).toBe(r.elegiveis);
      const fatura = await db.invoice.findFirst({
        where: { tenantId, subscriptionId: novo.subscriptionId, billingPeriod: new Date('2027-01-01T00:00:00Z') },
      });
      expect(fatura).not.toBeNull();
    } finally {
      jest.restoreAllMocks();
    }
  });
});
