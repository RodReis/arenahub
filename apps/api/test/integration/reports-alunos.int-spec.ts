import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { ConsultarInadimplenciaUseCase } from '../../src/modules/billing/consultar-inadimplencia.use-case.js';
import { ConsultarPagosUseCase } from '../../src/modules/billing/consultar-pagos.use-case.js';
import {
  lerFiltro,
  type FiltroDoRelatorioDeAlunos,
} from '../../src/modules/reports/domain/filtro-do-relatorio-de-alunos.js';
import { RelatorioDeAlunosRepository } from '../../src/modules/reports/relatorio-de-alunos.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import {
  apagarCenario,
  contextoDe,
  criarCenarioDeDiaria,
  criarPlano,
  type CenarioDeDiaria,
} from './helpers/cenario-de-diaria.js';

/**
 * Relatório de Alunos, contra Postgres de verdade (`docs/TESTING.md` §3): o
 * filtro por relação (`invoices some`, `subscriptions some`), a ordenação e a
 * paginação por cursor são comportamento do Prisma e do banco -- dublê
 * provaria só a sintaxe.
 */
describe('F90 -- consulta do Relatório de Alunos', () => {
  let db: PrismaService;
  let repo: RelatorioDeAlunosRepository;
  let inadimplencia: ConsultarInadimplenciaUseCase;
  let pagos: ConsultarPagosUseCase;
  let c: CenarioDeDiaria;
  let outro: CenarioDeDiaria;
  let ctx: TenantContext;
  let planoId: string;
  let planoOutroTenantId: string;
  let segundaUnidadeId: string;
  let numeroDaFatura = 1;

  const AGORA = new Date('2026-10-10T15:00:00.000Z');
  const SEM_FILTRO = lerFiltro({});
  const com = (f: Record<string, unknown>): FiltroDoRelatorioDeAlunos => lerFiltro(f);

  const nomes = async (filtro: FiltroDoRelatorioDeAlunos, limite = 100): Promise<string[]> =>
    (await repo.listar(ctx, filtro, AGORA, { limite })).map((l) => l.fullName);

  async function aluno(opcoes: {
    nome: string;
    unidadeId?: string;
    profile?: 'STUDENT' | 'TRAINER';
    status?: 'ACTIVE' | 'BLOCKED';
    cpf?: string;
    telefone?: string;
    catraca?: string;
    tenant?: CenarioDeDiaria;
  }): Promise<string> {
    const t = opcoes.tenant ?? c;
    const criado = await db.student.create({
      data: {
        tenantId: t.tenantId,
        gymUnitId: opcoes.unidadeId ?? t.unidadeId,
        membershipNumber: `F90-${randomUUID().slice(0, 8)}`,
        fullName: opcoes.nome,
        birthDate: new Date('1990-01-01T00:00:00Z'),
        status: opcoes.status ?? 'ACTIVE',
        profile: opcoes.profile ?? 'STUDENT',
        ...(opcoes.cpf ? { cpf: opcoes.cpf } : {}),
        ...(opcoes.telefone
          ? {
              contacts: {
                create: { tenantId: t.tenantId, type: 'PHONE', value: opcoes.telefone, isPrimary: true },
              },
            }
          : {}),
        ...(opcoes.catraca
          ? {
              credentials: {
                create: { tenantId: t.tenantId, kind: 'TURNSTILE_CARD', externalId: opcoes.catraca },
              },
            }
          : {}),
      },
      select: { id: true },
    });

    return criado.id;
  }

  async function assinatura(
    studentId: string,
    status: 'ACTIVE' | 'PAST_DUE' = 'ACTIVE',
    plano: string = planoId,
    tenant: CenarioDeDiaria = c,
  ): Promise<string> {
    const criada = await db.subscription.create({
      data: {
        tenantId: tenant.tenantId,
        studentId,
        planId: plano,
        status,
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
      select: { id: true },
    });

    return criada.id;
  }

  async function fatura(
    studentId: string,
    subscriptionId: string,
    situacao: { status: 'PAID'; paidAt: Date } | { status: 'OPEN' | 'OVERDUE'; dueAt: Date },
    periodo: string,
  ): Promise<void> {
    await db.invoice.create({
      data: {
        tenantId: c.tenantId,
        subscriptionId,
        studentId,
        billingPeriod: new Date(`${periodo}T00:00:00Z`),
        number: numeroDaFatura++,
        status: situacao.status,
        currency: 'BRL',
        subtotalMinor: 12_000,
        totalMinor: 12_000,
        dueAt: 'dueAt' in situacao ? situacao.dueAt : new Date('2026-08-10T14:00:00Z'),
        ...('paidAt' in situacao ? { paidAt: situacao.paidAt } : {}),
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    repo = comContextoDeTenant(moduleRef.get(RelatorioDeAlunosRepository, { strict: false }));
    inadimplencia = comContextoDeTenant(moduleRef.get(ConsultarInadimplenciaUseCase));
    pagos = comContextoDeTenant(moduleRef.get(ConsultarPagosUseCase));

    const senhas = moduleRef.get(PasswordService);
    c = await criarCenarioDeDiaria(db, senhas);
    outro = await criarCenarioDeDiaria(db, senhas);
    ctx = contextoDe(c);
    planoId = await criarPlano(db, c, { nome: 'Mensal Fit', billingMode: 'ASSINATURA' });
    planoOutroTenantId = await criarPlano(db, outro, { nome: 'Plano do Outro', billingMode: 'ASSINATURA' });

    const segunda = await db.gymUnit.create({
      data: {
        tenantId: c.tenantId,
        code: 'FIL',
        name: 'Filial',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    segundaUnidadeId = segunda.id;

    // A: pagante, plano, tudo preenchido -- Matriz
    const a = await aluno({ nome: 'Ana Pagante', cpf: '11144477735', telefone: '41999990000', catraca: '1042' });
    const subA = await assinatura(a);
    await fatura(a, subA, { status: 'PAID', paidAt: new Date('2026-09-05T12:00:00Z') }, '2026-09-01');

    // B: inadimplente (assinatura em atraso, fatura vencida em aberto) -- Matriz
    const b = await aluno({ nome: 'Bruno Devedor' });
    const subB = await assinatura(b, 'PAST_DUE');
    await fatura(b, subB, { status: 'OVERDUE', dueAt: new Date('2026-09-10T14:00:00Z') }, '2026-09-01');

    // C: bloqueado, sem plano, sem nada -- Filial
    await aluno({ nome: 'Carla Sem Nada', unidadeId: segundaUnidadeId, status: 'BLOCKED' });

    // D: professor com acesso por vínculo (sem assinatura) -- Matriz
    const d = await aluno({ nome: 'Davi Professor', profile: 'TRAINER' });
    await db.entitlement.create({
      data: {
        tenantId: c.tenantId,
        studentId: d,
        source: 'EMPLOYEE',
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2027-01-01T00:00:00Z'),
        policySnapshot: {},
      },
    });

    // G: SEGUNDA inadimplente, em outro plano -- faz o total de inadimplentes (2) diferir do de
    // pagantes (1), para que a PARIDADE com a Cobrança não passe por coincidência de contagem.
    const planoAnual = await criarPlano(db, c, { nome: 'Anual Black', billingMode: 'ASSINATURA' });
    const g = await aluno({ nome: 'Gabi Devedora' });
    const subG = await assinatura(g, 'PAST_DUE', planoAnual);
    await fatura(g, subG, { status: 'OPEN', dueAt: new Date('2026-09-20T14:00:00Z') }, '2026-09-01');

    // E, F: alunos de OUTRO tenant -- nunca podem aparecer
    await aluno({ nome: 'Eva de Outro Tenant', tenant: outro });
    const f = await aluno({ nome: 'Fabio de Outro', tenant: outro });
    await assinatura(f, 'ACTIVE', planoOutroTenantId, outro);
  });

  afterAll(async () => {
    await apagarCenario(db, c);
    await apagarCenario(db, outro);
  });

  it('sem filtro: todos os perfis do tenant, por nome, e NUNCA de outro tenant', async () => {
    expect(await nomes(SEM_FILTRO)).toEqual([
      'Ana Pagante',
      'Bruno Devedor',
      'Carla Sem Nada',
      'Davi Professor',
      'Gabi Devedora',
    ]);
    expect(await repo.contar(ctx, SEM_FILTRO, AGORA)).toBe(5);
  });

  it('perfil filtra (vazio = todos)', async () => {
    expect(await nomes(com({ profile: 'TRAINER' }))).toEqual(['Davi Professor']);
    expect(await nomes(com({ profile: 'STUDENT' }))).toEqual([
      'Ana Pagante',
      'Bruno Devedor',
      'Carla Sem Nada',
      'Gabi Devedora',
    ]);
  });

  it('situação e unidade filtram', async () => {
    expect(await nomes(com({ status: 'BLOCKED' }))).toEqual(['Carla Sem Nada']);
    expect(await nomes(com({ gymUnitId: segundaUnidadeId }))).toEqual(['Carla Sem Nada']);
  });

  it('plano filtra pela assinatura vigente (ACTIVE ou PAST_DUE)', async () => {
    expect(await nomes(com({ planId: planoId }))).toEqual(['Ana Pagante', 'Bruno Devedor']);
  });

  it('plano de OUTRO tenant não vaza: zero linhas, não erro', async () => {
    expect(await nomes(com({ planId: planoOutroTenantId }))).toEqual([]);
    expect(await repo.contar(ctx, com({ planId: planoOutroTenantId }), AGORA)).toBe(0);
  });

  it('financeiro=INADIMPLENTES traz só quem tem fatura vencida em aberto', async () => {
    expect(await nomes(com({ financeiro: 'INADIMPLENTES' }))).toEqual(['Bruno Devedor', 'Gabi Devedora']);
  });

  it('financeiro=PAGANTES traz só quem tem fatura paga', async () => {
    expect(await nomes(com({ financeiro: 'PAGANTES' }))).toEqual(['Ana Pagante']);
  });

  it('filtros combinam (E lógico)', async () => {
    expect(
      await nomes(com({ planId: planoId, financeiro: 'INADIMPLENTES', status: 'ACTIVE' })),
    ).toEqual(['Bruno Devedor']);
    expect(await nomes(com({ planId: planoId, status: 'BLOCKED' }))).toEqual([]);
  });

  it('PARIDADE com a Cobrança: mesmo número de inadimplentes e de pagantes que as duas telas', async () => {
    const painel = await inadimplencia.executar(ctx, AGORA);
    const abaPagantes = await pagos.executar(ctx);

    // Contagens DIFERENTES de propósito (2 x 1): trocar um critério pelo outro derruba a paridade.
    expect(painel.resumo.alunosInadimplentes).toBe(2);
    expect(abaPagantes.total).toBe(1);

    expect(await repo.contar(ctx, com({ financeiro: 'INADIMPLENTES' }), AGORA)).toBe(
      painel.resumo.alunosInadimplentes,
    );
    expect(await repo.contar(ctx, com({ financeiro: 'PAGANTES' }), AGORA)).toBe(abaPagantes.total);
  });

  it('linha completa: catraca, CPF, telefone e nome do plano', async () => {
    const [ana] = await repo.listar(ctx, com({ financeiro: 'PAGANTES' }), AGORA, { limite: 10 });

    expect(ana).toMatchObject({
      fullName: 'Ana Pagante',
      deviceIds: ['1042'],
      cpf: '11144477735',
      phone: '41999990000',
      planLabel: 'Mensal Fit',
    });
  });

  it('aluno sem nada: vazio e null, sem inventar valor', async () => {
    const [carla] = await repo.listar(ctx, com({ status: 'BLOCKED' }), AGORA, { limite: 10 });

    expect(carla).toMatchObject({
      deviceIds: [],
      cpf: null,
      phone: null,
      planLabel: null,
    });
  });

  it('acesso por vínculo mostra a ORIGEM no lugar do plano', async () => {
    const [davi] = await repo.listar(ctx, com({ profile: 'TRAINER' }), AGORA, { limite: 10 });

    expect(davi?.planLabel).toBe('Funcionário');
  });

  it('cursor pagina sem repetir nem pular, e cursor inexistente não derruba', async () => {
    const primeira = await repo.listar(ctx, SEM_FILTRO, AGORA, { limite: 2 });
    const segunda = await repo.listar(ctx, SEM_FILTRO, AGORA, {
      limite: 2,
      cursor: primeira[1]?.studentId,
    });

    expect(primeira.map((l) => l.fullName)).toEqual(['Ana Pagante', 'Bruno Devedor']);
    expect(segunda.map((l) => l.fullName)).toEqual(['Carla Sem Nada', 'Davi Professor']);
    await expect(
      repo.listar(ctx, SEM_FILTRO, AGORA, { limite: 2, cursor: randomUUID() }),
    ).resolves.toBeDefined();
  });
});
