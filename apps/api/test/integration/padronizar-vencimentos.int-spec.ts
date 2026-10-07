import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';

import { AppModule } from '../../src/app.module.js';
import { BillingRepository } from '../../src/modules/billing/billing.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { executarSaneamento } from '../../src/scripts/padronizar-vencimentos/executar.js';
import { silenciarAgendadores } from '../../src/scripts/padronizar-vencimentos/seguranca.js';

/**
 * Saneamento da F88 (SPEC-088 4.5) contra banco de verdade: dry-run nao grava,
 * `--gravar` aplica tudo, a segunda execucao nao muda nada (`docs/TESTING.md` 3).
 *
 * "Agora" fixo em 07/10/2026 15:00Z. O tenant nasce com carencia 10 (o legado),
 * para provar o passo 1 e que o passo 4 ja abre fatura com a carencia nova.
 */
describe('padronizar-vencimentos (executarSaneamento)', () => {
  const agora = new Date('2026-10-07T15:00:00Z');
  const d = (iso: string): Date => new Date(iso);

  let moduleRef: TestingModule;
  let db: PrismaService;
  let billing: BillingRepository;

  const sufixo = randomUUID().slice(0, 8);
  const slug = `pad-${sufixo}`;
  let tenantId = '';
  let unidadeId = '';
  let planoMensalId = '';
  let planoDiariaId = '';
  let contador = 0;

  const matriculas = { semAssinatura: '', ancorada: '', vencidaSet: '', outAberta: '', outVencida: '' };
  const ids = { ancorada: '', vencidaSet: '', outAberta: '', outVencida: '', diaria: '', staff: '', semOut: '' };
  const subs = { vencidaSet: '', outVencida: '', pagaLote: '', pagaAvulsa: '' };
  const faturas = { nov: '', set: '', outAberta: '', outVencida: '', diaria: '', loteOut: '', loteNov: '', loteDez: '', avulsa: '', diariaPaga: '' };

  async function aluno(profile: 'STUDENT' | 'STAFF', plano: string | null, statusSub: 'ACTIVE' | 'PAST_DUE' = 'ACTIVE') {
    contador += 1;
    const matricula = `PAD-${sufixo}-${contador}`;
    const estudante = await db.student.create({
      data: {
        tenantId,
        gymUnitId: unidadeId,
        membershipNumber: matricula,
        fullName: `Nome Sigiloso ${contador}`,
        birthDate: d('2000-01-01T00:00:00Z'),
        profile,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    const assinatura = plano
      ? await db.subscription.create({
          data: { tenantId, studentId: estudante.id, planId: plano, status: statusSub, startsAt: d('2026-01-01T00:00:00Z') },
          select: { id: true },
        })
      : null;

    return { matricula, studentId: estudante.id, subscriptionId: assinatura?.id ?? '' };
  }

  async function fatura(
    a: { studentId: string; subscriptionId: string },
    o: { periodo: string; status: 'OPEN' | 'OVERDUE' | 'PAID'; dueAt: string; blockAt: string | null; paidAt?: string },
  ): Promise<string> {
    contador += 1;
    const f = await db.invoice.create({
      data: {
        tenantId,
        subscriptionId: a.subscriptionId,
        studentId: a.studentId,
        billingPeriod: d(o.periodo),
        status: o.status,
        number: contador,
        subtotalMinor: 10000,
        totalMinor: 10000,
        dueAt: d(o.dueAt),
        blockAt: o.blockAt ? d(o.blockAt) : null,
        paidAt: o.paidAt ? d(o.paidAt) : null,
      },
      select: { id: true },
    });

    return f.id;
  }

  async function pagamento(invoiceId: string, paidAt: string, batchId: string | null): Promise<void> {
    await db.payment.create({
      data: { tenantId, invoiceId, amountMinor: 10000, method: 'MANUAL', status: 'CONFIRMED', paidAt: d(paidAt), batchId },
    });
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    billing = moduleRef.get(BillingRepository);

    const tenant = await db.tenant.create({
      data: { slug, legalName: `Padronizar ${sufixo} LTDA`, displayName: `Padronizar ${sufixo}` },
    });
    tenantId = tenant.id;
    await db.billingSettings.create({ data: { tenantId, dueDay: 10, graceDays: 10 } });
    const unidade = await db.gymUnit.create({
      data: { tenantId, code: 'SP', name: 'Sao Paulo', timezone: 'America/Sao_Paulo', openingHours: {} },
    });
    unidadeId = unidade.id;

    const preco = { create: [{ tenantId, amountMinor: 10000, currency: 'BRL', validFrom: d('2026-01-01T00:00:00Z') }] };
    planoMensalId = (
      await db.plan.create({ data: { tenantId, name: `Mensal ${sufixo}`, billingMode: 'AVULSO', prices: preco }, select: { id: true } })
    ).id;
    planoDiariaId = (
      await db.plan.create({ data: { tenantId, name: `Diaria ${sufixo}`, billingMode: 'DIARIA', prices: preco }, select: { id: true } })
    ).id;

    // A: fatura de novembro ancorada em 06/11 (modelo antigo).
    const A = await aluno('STUDENT', planoMensalId);
    matriculas.ancorada = A.matricula;
    ids.ancorada = A.studentId;
    faturas.nov = await fatura(A, { periodo: '2026-11-01', status: 'OPEN', dueAt: '2026-11-06', blockAt: '2026-11-16T00:00:00Z' });

    // B: set/26 OVERDUE (continua vencida), assinatura PAST_DUE e direito suspenso.
    const B = await aluno('STUDENT', planoMensalId, 'PAST_DUE');
    matriculas.vencidaSet = B.matricula;
    ids.vencidaSet = B.studentId;
    subs.vencidaSet = B.subscriptionId;
    faturas.set = await fatura(B, { periodo: '2026-09-01', status: 'OVERDUE', dueAt: '2026-09-10', blockAt: null });
    await db.entitlement.create({
      data: {
        tenantId, studentId: B.studentId, subscriptionId: B.subscriptionId, source: 'SUBSCRIPTION', status: 'SUSPENDED',
        policySnapshot: {}, startsAt: d('2026-08-01T00:00:00Z'), endsAt: d('2027-08-01T00:00:00Z'), suspendedAt: d('2026-09-20T03:00:00Z'),
      },
    });

    // C: out/26 aberta com vencimento em 09/10.
    const C = await aluno('STUDENT', planoMensalId);
    matriculas.outAberta = C.matricula;
    ids.outAberta = C.studentId;
    faturas.outAberta = await fatura(C, { periodo: '2026-10-01', status: 'OPEN', dueAt: '2026-10-09', blockAt: '2026-10-12T00:00:00Z' });

    // D: out/26 OVERDUE pelo modelo antigo; com a data nova (15/10) volta a OPEN e reativa.
    const D = await aluno('STUDENT', planoMensalId, 'PAST_DUE');
    matriculas.outVencida = D.matricula;
    ids.outVencida = D.studentId;
    subs.outVencida = D.subscriptionId;
    faturas.outVencida = await fatura(D, { periodo: '2026-10-01', status: 'OVERDUE', dueAt: '2026-10-03', blockAt: '2026-10-04T00:00:00Z' });
    await db.entitlement.create({
      data: {
        tenantId, studentId: D.studentId, subscriptionId: D.subscriptionId, source: 'SUBSCRIPTION', status: 'SUSPENDED',
        policySnapshot: {}, startsAt: d('2026-08-01T00:00:00Z'), endsAt: d('2027-08-01T00:00:00Z'), suspendedAt: d('2026-10-04T00:00:00Z'),
      },
    });

    // E: lote de 3 meses pago em 07/10 (out+nov+dez), sem cobertura.
    const E = await aluno('STUDENT', planoMensalId);
    subs.pagaLote = E.subscriptionId;
    const lote = `lote-${sufixo}`;
    for (const [chave, periodo] of [['loteOut', '2026-10-01'], ['loteNov', '2026-11-01'], ['loteDez', '2026-12-01']] as const) {
      const id = await fatura(E, { periodo, status: 'PAID', dueAt: `${periodo.slice(0, 8)}10`, blockAt: null, paidAt: '2026-10-07T12:00:00Z' });
      faturas[chave] = id;
      await pagamento(id, '2026-10-07T12:00:00Z', lote);
    }

    // F: set/26 paga avulsa em 05/09; nao tem out/26.
    const F = await aluno('STUDENT', planoMensalId);
    subs.pagaAvulsa = F.subscriptionId;
    faturas.avulsa = await fatura(F, { periodo: '2026-09-01', status: 'PAID', dueAt: '2026-09-10', blockAt: null, paidAt: '2026-09-05T18:00:00Z' });
    await pagamento(faturas.avulsa, '2026-09-05T18:00:00Z', null);

    // G: STUDENT ativo sem nenhuma fatura (precisa de out/26).
    const G = await aluno('STUDENT', planoMensalId);
    ids.semOut = G.studentId;

    // H: STAFF (nao recebe fatura). I: diaria com datas explicitas. J: STUDENT sem assinatura.
    ids.staff = (await aluno('STAFF', planoMensalId)).studentId;
    const I = await aluno('STUDENT', planoDiariaId);
    ids.diaria = I.studentId;
    faturas.diaria = await fatura(I, { periodo: '2026-10-01', status: 'OPEN', dueAt: '2026-10-07', blockAt: '2026-10-08T03:00:00Z' });
    // Diaria PAGA sem cobertura: o passe ja tem o proprio fim; o script nao pode escrever pagamento + 30.
    faturas.diariaPaga = await fatura(I, { periodo: '2026-09-01', status: 'PAID', dueAt: '2026-09-05', blockAt: null, paidAt: '2026-09-05T18:00:00Z' });
    await pagamento(faturas.diariaPaga, '2026-09-05T18:00:00Z', null);
    matriculas.semAssinatura = (await aluno('STUDENT', null)).matricula;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: tenantId } });
    await moduleRef.close();
  });

  /** Fotografia de tudo que o script pode tocar. */
  async function foto(): Promise<string> {
    const [invoices, assinaturas, direitos, config] = await Promise.all([
      db.invoice.findMany({ where: { tenantId }, orderBy: { number: 'asc' } }),
      db.subscription.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
      db.entitlement.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
      db.billingSettings.findUnique({ where: { tenantId } }),
    ]);

    return JSON.stringify({ invoices, assinaturas, direitos, config });
  }

  const rodar = (gravar: boolean) => {
    const linhas: string[] = [];
    return executarSaneamento({ db, billing }, { slug, gravar, agora, escrever: (l) => linhas.push(l) }).then((r) => ({ r, linhas }));
  };

  it('dry-run planeja tudo e nao grava nada; a saida so tem matriculas', async () => {
    const antes = await foto();

    const { r, linhas } = await rodar(false);

    expect(await foto()).toBe(antes);
    expect(r).toMatchObject({
      carenciaAjustada: 1,
      faturasRedatadas: 4,
      overdueParaOpen: 1,
      assinaturasReativadas: 1,
      outubroCriadas: 4,
      coberturasPreenchidas: 4,
      falhas: 0,
      pagasSemData: 0,
    });
    expect(r.semAssinaturaVigente).toEqual([matriculas.semAssinatura]);
    expect(r.seriamBloqueados).toEqual([matriculas.vencidaSet]);
    expect(linhas.join('\n')).not.toContain('Sigiloso');
    // Antes de 15/10 a out/26 nova ainda nao bloqueia: sem linha de alerta.
    expect(linhas).toContain('[padronizar] seriam bloqueados por out/26 nova   : 0');
    expect(linhas.some((l) => l.includes('ATENCAO'))).toBe(false);
    expect(linhas.some((l) => l.includes(matriculas.vencidaSet))).toBe(true);
  });

  it('--gravar aplica cada mudanca esperada', async () => {
    const { r } = await rodar(true);

    expect(r).toMatchObject({
      carenciaAjustada: 1, faturasRedatadas: 4, overdueParaOpen: 1, assinaturasReativadas: 1,
      outubroCriadas: 4, coberturasPreenchidas: 4, falhas: 0,
    });

    expect((await db.billingSettings.findUniqueOrThrow({ where: { tenantId } })).graceDays).toBe(5);

    const nov = await db.invoice.findUniqueOrThrow({ where: { id: faturas.nov } });
    expect([nov.dueAt, nov.blockAt]).toEqual([d('2026-11-10T00:00:00Z'), d('2026-11-15T03:00:00Z')]);

    const set = await db.invoice.findUniqueOrThrow({ where: { id: faturas.set } });
    expect([set.status, set.dueAt, set.blockAt]).toEqual(['OVERDUE', d('2026-09-10T00:00:00Z'), d('2026-09-15T03:00:00Z')]);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: subs.vencidaSet } })).status).toBe('PAST_DUE');
    expect((await db.entitlement.findFirstOrThrow({ where: { subscriptionId: subs.vencidaSet } })).status).toBe('SUSPENDED');

    const outAberta = await db.invoice.findUniqueOrThrow({ where: { id: faturas.outAberta } });
    expect([outAberta.dueAt, outAberta.blockAt]).toEqual([d('2026-10-10T00:00:00Z'), d('2026-10-15T03:00:00Z')]);

    const outVencida = await db.invoice.findUniqueOrThrow({ where: { id: faturas.outVencida } });
    expect([outVencida.status, outVencida.blockAt]).toEqual(['OPEN', d('2026-10-15T03:00:00Z')]);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: subs.outVencida } })).status).toBe('ACTIVE');
    expect((await db.entitlement.findFirstOrThrow({ where: { subscriptionId: subs.outVencida } })).status).toBe('ACTIVE');

    // Diaria intocada.
    const diaria = await db.invoice.findUniqueOrThrow({ where: { id: faturas.diaria } });
    expect([diaria.dueAt, diaria.blockAt, diaria.status]).toEqual([d('2026-10-07T00:00:00Z'), d('2026-10-08T03:00:00Z'), 'OPEN']);

    // Out/26 so para quem era elegivel e nao tinha: A, B, F e G -- ja com a carencia nova.
    const criadas = await db.invoice.findMany({
      where: { tenantId, billingPeriod: d('2026-10-01T00:00:00Z'), studentId: { in: [ids.ancorada, ids.vencidaSet, ids.semOut] } },
    });
    expect(criadas).toHaveLength(3);
    expect(criadas.every((f) => f.dueAt.getTime() === d('2026-10-10T00:00:00Z').getTime())).toBe(true);
    expect(criadas.every((f) => f.blockAt!.getTime() === d('2026-10-15T03:00:00Z').getTime())).toBe(true);
    expect(await db.invoice.count({ where: { tenantId, billingPeriod: d('2026-10-01T00:00:00Z'), subscriptionId: subs.pagaAvulsa } })).toBe(1);
    expect(await db.invoice.count({ where: { tenantId, studentId: { in: [ids.staff, ids.diaria] }, billingPeriod: d('2026-10-01T00:00:00Z') } })).toBe(1);

    expect((await db.invoice.findUniqueOrThrow({ where: { id: faturas.diariaPaga } })).coverageEndsAt).toBeNull();

    const cobertura = async (id: string) => (await db.invoice.findUniqueOrThrow({ where: { id } })).coverageEndsAt?.toISOString().slice(0, 10);
    expect([await cobertura(faturas.loteOut), await cobertura(faturas.loteNov), await cobertura(faturas.loteDez), await cobertura(faturas.avulsa)]).toEqual([
      '2026-11-06', '2026-12-06', '2027-01-05', '2026-10-05',
    ]);
  });

  it('segunda execucao com --gravar nao muda nada', async () => {
    const antes = await foto();

    const { r } = await rodar(true);

    expect(r).toMatchObject({
      carenciaAjustada: 0, faturasRedatadas: 0, overdueParaOpen: 0, assinaturasReativadas: 0,
      outubroCriadas: 0, coberturasPreenchidas: 0, falhas: 0,
    });
    expect(await foto()).toBe(antes);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: faturas.diariaPaga } })).coverageEndsAt).toBeNull();
    expect(r.seriamBloqueados).toEqual([matriculas.vencidaSet]);
  });

  it('silenciarAgendadores para todo cron, interval e timeout do AppModule', async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await modulo.init();

    try {
      const registro = modulo.get(SchedulerRegistry);
      const crons = [...registro.getCronJobs().values()];

      // Sem isto o teste passaria em falso (nada agendado = nada a parar).
      expect(crons.length).toBeGreaterThan(0);
      expect(crons.some((c) => c.isActive)).toBe(true);

      silenciarAgendadores(modulo);

      expect(crons.some((c) => c.isActive)).toBe(false);
      expect(registro.getCronJobs().size).toBe(0);
      expect(registro.getIntervals()).toEqual([]);
      expect(registro.getTimeouts()).toEqual([]);
    } finally {
      await modulo.close();
    }
  });

  it('depois de 15/10, a out/26 que o script cria ja nasce bloqueando: entra no relatorio e avisa', async () => {
    const outro = await db.tenant.create({
      data: { slug: `pad-b-${sufixo}`, legalName: `Padronizar B ${sufixo} LTDA`, displayName: `Padronizar B ${sufixo}` },
    });

    try {
      await db.billingSettings.create({ data: { tenantId: outro.id, dueDay: 10, graceDays: 5 } });
      const unidade = await db.gymUnit.create({
        data: { tenantId: outro.id, code: 'SP', name: 'Sao Paulo', timezone: 'America/Sao_Paulo', openingHours: {} },
      });
      const plano = await db.plan.create({
        data: {
          tenantId: outro.id, name: `Mensal B ${sufixo}`, billingMode: 'AVULSO',
          prices: { create: [{ tenantId: outro.id, amountMinor: 10000, currency: 'BRL', validFrom: d('2026-01-01T00:00:00Z') }] },
        },
        select: { id: true },
      });
      const matricula = `PADB-${sufixo}`;
      const estudante = await db.student.create({
        data: {
          tenantId: outro.id, gymUnitId: unidade.id, membershipNumber: matricula, fullName: 'Nome Sigiloso B',
          birthDate: d('2000-01-01T00:00:00Z'), profile: 'STUDENT', status: 'ACTIVE',
        },
        select: { id: true },
      });
      await db.subscription.create({
        data: { tenantId: outro.id, studentId: estudante.id, planId: plano.id, status: 'ACTIVE', startsAt: d('2026-01-01T00:00:00Z') },
      });

      const linhas: string[] = [];
      const r = await executarSaneamento(
        { db, billing },
        { slug: outro.slug, gravar: false, agora: d('2026-10-16T12:00:00Z'), escrever: (l) => linhas.push(l) },
      );

      expect(r.outubroCriadas).toBe(1);
      expect(r.seriamBloqueados).toEqual([matricula]);
      expect(linhas).toContain('[padronizar] seriam bloqueados por out/26 nova   : 1');
      expect(linhas.some((l) => l.startsWith('[padronizar] ATENCAO'))).toBe(true);
      expect(linhas.join('\n')).not.toContain('Sigiloso');
    } finally {
      await db.tenant.deleteMany({ where: { id: outro.id } });
    }
  });

  it('para quando o dueDay do tenant nao e 10', async () => {
    const outro = await db.tenant.create({
      data: { slug: `pad-x-${sufixo}`, legalName: `Padronizar X ${sufixo} LTDA`, displayName: `Padronizar X ${sufixo}` },
    });
    await db.billingSettings.create({ data: { tenantId: outro.id, dueDay: 15, graceDays: 3 } });

    try {
      await expect(
        executarSaneamento({ db, billing }, { slug: outro.slug, gravar: true, agora, escrever: () => undefined }),
      ).rejects.toThrow(/dueDay do tenant e 15/);
      expect((await db.billingSettings.findUniqueOrThrow({ where: { tenantId: outro.id } })).graceDays).toBe(3);
    } finally {
      await db.tenant.deleteMany({ where: { id: outro.id } });
    }
  });
});
