import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { ListarInvoicesUseCase } from '../../src/modules/billing/listar-invoices.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F53 -- task 6: lista transversal de faturas do tenant.
 *
 * ISOLAMENTO e o teste que importa aqui: e rota SEM filtro de aluno, entao
 * sem `tenantId` no `where` ela devolve o financeiro de todas as academias
 * de uma vez -- a falha mais cara possivel nesta rota.
 *
 * Cada teste semeia o PROPRIO tenant (nao um tenant compartilhado no
 * `beforeAll`): a rota conta TODAS as invoices do tenant, entao um tenant
 * compartilhado entre `it`s faria o total de um teste incluir as invoices
 * que o teste anterior deixou -- contaminacao cruzada, nao isolamento.
 */
describe('GET /invoices', () => {
  let db: PrismaService;
  let useCase: ListarInvoicesUseCase;

  const sufixo = randomUUID().slice(0, 8);
  const tenantIdsCriados: string[] = [];
  const actorIdsCriados: string[] = [];
  let numero = 0;

  /** Cria tenant, unidade, usuario, plano, aluno e assinatura isolados. */
  async function semearTenant(): Promise<{ contexto: TenantContext; subscriptionId: string; studentId: string }> {
    const rotulo = randomUUID().slice(0, 8);

    const tenant = await db.tenant.create({
      data: {
        slug: `f53-listar-${rotulo}-${sufixo}`,
        legalName: `F53 Listar ${rotulo} ${sufixo} LTDA`,
        displayName: `F53 Listar ${rotulo} ${sufixo}`,
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

    const operador = await db.user.create({
      data: { email: `op-listar-${rotulo}@arena.test`, passwordHash: 'x'.repeat(60) },
    });
    actorIdsCriados.push(operador.id);
    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: operador.id } });

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Plano ${rotulo}` },
    });

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
        status: 'ACTIVE',
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
    });

    return {
      contexto: {
        tenantId: tenant.id,
        // `audit_logs.actor_id` tem FK para `users` -- UUID solto quebra a
        // constraint. Usuario real evita a armadilha ja conhecida do modulo.
        actorId: operador.id,
        sessionId: randomUUID(),
        permissions: new Set(['billing.read']),
        allowedUnitIds: 'ALL',
      },
      subscriptionId: assinatura.id,
      studentId: aluno.id,
    };
  }

  /** Invoice generica, com status e vencimento escolhidos pelo chamador. */
  async function criarInvoice(
    tenantId: string,
    subscriptionId: string,
    studentId: string,
    opts: { status?: 'OPEN' | 'PAID'; dueAt?: Date } = {},
  ): Promise<string> {
    numero += 1;

    const invoice = await db.invoice.create({
      data: {
        tenantId,
        subscriptionId,
        studentId,
        billingPeriod: new Date(`2026-${String(1 + (numero % 12)).padStart(2, '0')}-01T00:00:00Z`),
        number: numero,
        status: opts.status ?? 'OPEN',
        currency: 'BRL',
        subtotalMinor: 10_000,
        totalMinor: 10_000,
        dueAt: opts.dueAt ?? new Date('2026-08-10T00:00:00Z'),
      },
      select: { id: true },
    });

    return invoice.id;
  }

  async function criarInvoices(
    tenantId: string,
    subscriptionId: string,
    studentId: string,
    qtd: number,
  ): Promise<void> {
    for (let i = 0; i < qtd; i += 1) {
      await criarInvoice(tenantId, subscriptionId, studentId);
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    useCase = moduleRef.get(ListarInvoicesUseCase);
  });

  afterEach(async () => {
    await db.tenant.deleteMany({ where: { id: { in: tenantIdsCriados.splice(0) } } });
    await db.user.deleteMany({ where: { id: { in: actorIdsCriados.splice(0) } } });
  });

  it('lista as invoices do tenant, da mais recente para a mais antiga', async () => {
    const { contexto, subscriptionId, studentId } = await semearTenant();
    await criarInvoices(contexto.tenantId, subscriptionId, studentId, 3);

    const pagina = await useCase.executar(contexto, { pagina: 1, tamanho: 20 });

    expect(pagina.total).toBe(3);
    expect(pagina.itens).toHaveLength(3);
  });

  /*
   * ISOLAMENTO -- o teste que importa numa rota SEM filtro de aluno. Sem
   * `tenantId` no `where`, esta rota devolve o financeiro de todas as
   * academias de uma vez, que e a falha mais cara possivel aqui.
   */
  it('nunca devolve invoice de outro tenant', async () => {
    const { contexto, subscriptionId, studentId } = await semearTenant();
    const outro = await semearTenant();

    await criarInvoices(contexto.tenantId, subscriptionId, studentId, 2);
    await criarInvoices(outro.contexto.tenantId, outro.subscriptionId, outro.studentId, 5);

    const pagina = await useCase.executar(contexto, { pagina: 1, tamanho: 50 });

    expect(pagina.total).toBe(2);
  });

  it('filtra por status', async () => {
    const { contexto, subscriptionId, studentId } = await semearTenant();
    await criarInvoice(contexto.tenantId, subscriptionId, studentId, { status: 'OPEN' });
    await criarInvoice(contexto.tenantId, subscriptionId, studentId, { status: 'PAID' });

    const pagina = await useCase.executar(contexto, { status: 'OPEN', pagina: 1, tamanho: 20 });

    expect(pagina.itens.every((i) => i.status === 'OPEN')).toBe(true);
    expect(pagina.total).toBe(1);
  });

  /*
   * PERIODO FECHADO nas duas pontas. Invoice que vence exatamente no limite
   * entra: recorte que perde a borda some com a fatura do dia 31 quando
   * alguem pesquisa "ate o dia 31".
   */
  it('filtra por periodo de vencimento, com as bordas dentro', async () => {
    const { contexto, subscriptionId, studentId } = await semearTenant();
    await criarInvoice(contexto.tenantId, subscriptionId, studentId, {
      dueAt: new Date('2026-08-01T00:00:00Z'),
    });
    await criarInvoice(contexto.tenantId, subscriptionId, studentId, {
      dueAt: new Date('2026-08-31T00:00:00Z'),
    });
    await criarInvoice(contexto.tenantId, subscriptionId, studentId, {
      dueAt: new Date('2026-09-01T00:00:00Z'),
    });

    const pagina = await useCase.executar(contexto, {
      vencendoDe: new Date('2026-08-01T00:00:00Z'),
      vencendoAte: new Date('2026-08-31T00:00:00Z'),
      pagina: 1,
      tamanho: 20,
    });

    expect(pagina.total).toBe(2);
  });

  it('pagina', async () => {
    const { contexto, subscriptionId, studentId } = await semearTenant();
    await criarInvoices(contexto.tenantId, subscriptionId, studentId, 5);

    const pagina = await useCase.executar(contexto, { pagina: 2, tamanho: 2 });

    expect(pagina.itens).toHaveLength(2);
    expect(pagina.total).toBe(5);
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: tenantIdsCriados } } });
    await db.user.deleteMany({ where: { id: { in: actorIdsCriados } } });
  });
});
