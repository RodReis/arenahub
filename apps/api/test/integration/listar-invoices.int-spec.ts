import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import {
  ListarInvoicesUseCase,
  TAMANHO_MAXIMO_DA_PAGINA,
} from '../../src/modules/billing/listar-invoices.use-case.js';
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

    // `billing_period` entra na constraint de unicidade (INV-066) junto com
    // `tenant_id`/`subscription_id`: precisa ser DIFERENTE a cada chamada
    // desta funcao, mesmo com centenas de invoices na mesma assinatura (teste
    // do teto de pagina cria 100+). Mes/ano crescendo sem voltar evita a
    // colisao que `numero % 12` teria a partir da 13a invoice.
    const anoBase = 2000 + Math.floor(numero / 12);
    const mesBase = 1 + (numero % 12);

    const invoice = await db.invoice.create({
      data: {
        tenantId,
        subscriptionId,
        studentId,
        billingPeriod: new Date(`${anoBase}-${String(mesBase).padStart(2, '0')}-01T00:00:00Z`),
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

  /**
   * ORDEM TOTAL, e o teste afirma a ORDEM -- nao so a contagem.
   *
   * A versao anterior deste teste tinha este nome e conferia apenas
   * `total === 3`: apagar o `orderBy` do caso de uso a deixava verde. Guarda
   * que nao falha sem a coisa que guarda e decorativa.
   *
   * O empate de `dueAt` esta aqui de proposito, e e o caso que o `id` como
   * segunda chave existe para resolver: numa lista PAGINADA, duas linhas que
   * trocam de lugar entre dois carregamentos fazem uma aparecer duas vezes e
   * a outra nunca.
   */
  it('ordena por vencimento decrescente, com o id desempatando', async () => {
    const { contexto, subscriptionId, studentId } = await semearTenant();

    const meioId = await criarInvoice(contexto.tenantId, subscriptionId, studentId, {
      dueAt: new Date('2026-08-10T00:00:00Z'),
    });
    const empatadaId = await criarInvoice(contexto.tenantId, subscriptionId, studentId, {
      dueAt: new Date('2026-08-10T00:00:00Z'),
    });
    const maisNovaId = await criarInvoice(contexto.tenantId, subscriptionId, studentId, {
      dueAt: new Date('2026-09-10T00:00:00Z'),
    });
    const maisVelhaId = await criarInvoice(contexto.tenantId, subscriptionId, studentId, {
      dueAt: new Date('2026-07-10T00:00:00Z'),
    });

    const pagina = await useCase.executar(contexto, { pagina: 1, tamanho: 20 });

    expect(pagina.total).toBe(4);

    const vencimentos = pagina.itens.map((i) => new Date(i.dueAt).getTime());
    expect(vencimentos).toEqual([...vencimentos].sort((a, b) => b - a));

    // As duas do mesmo vencimento saem por `id desc`, sempre na mesma ordem.
    const [maiorId, menorId] = [meioId, empatadaId].sort().reverse();
    expect(pagina.itens.map((i) => i.id)).toEqual([maisNovaId, maiorId, menorId, maisVelhaId]);
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

  /*
   * TETO DE PAGINA -- o teste que prova que o teto e IMPOSTO, nao so
   * declarado. O teto existe em duas camadas (Zod no controller, `Math.min`
   * no caso de uso); este teste ataca a camada de baixo direto, contornando
   * o Zod, para provar que o caso de uso NAO confia cegamente em quem
   * chama. Pedir `tamanho: 100000` sem o `Math.min` devolveria o financeiro
   * inteiro do tenant numa pagina so.
   */
  it('nunca devolve mais que o teto de pagina, mesmo pedindo muito mais', async () => {
    const { contexto, subscriptionId, studentId } = await semearTenant();
    await criarInvoices(contexto.tenantId, subscriptionId, studentId, TAMANHO_MAXIMO_DA_PAGINA + 5);

    const pagina = await useCase.executar(contexto, { pagina: 1, tamanho: 100_000 });

    expect(pagina.itens.length).toBeLessThanOrEqual(TAMANHO_MAXIMO_DA_PAGINA);
    expect(pagina.itens).toHaveLength(TAMANHO_MAXIMO_DA_PAGINA);
    // O total real (acima do teto) prova que o corte foi na PAGINA, nao nos
    // dados -- a fatura extra existe, so nao veio nesta resposta.
    expect(pagina.total).toBe(TAMANHO_MAXIMO_DA_PAGINA + 5);
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: tenantIdsCriados } } });
    await db.user.deleteMany({ where: { id: { in: actorIdsCriados } } });
  });
});

/**
 * `status` invalido tem de ser 400, NAO lista vazia -- esta e a prova a
 * nivel HTTP, onde o Zod do controller (`esquemaDeListagem`) realmente
 * roda. `?status=xyz` que passasse pelo boundary chegaria como string
 * livre no `where` do Prisma, o Postgres nao acharia nada, e o cliente leria
 * `total: 0` como "tenant sem fatura" -- erro de digitacao virando resposta
 * vazia em silencio.
 */
describe('GET /invoices -- validacao HTTP do filtro de status', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-listagem';
  let tenantId = '';
  let cookie = '';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `f53-listar-http-${sufixo}`,
        legalName: `F53 Listar HTTP ${sufixo} LTDA`,
        displayName: `F53 Listar HTTP ${sufixo}`,
      },
    });
    tenantId = tenant.id;

    const usuario = await db.user.create({
      data: {
        email: `f53-listar-http-${sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash(SENHA),
      },
    });
    await db.tenantMembership.create({ data: { tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId, name: `PAPEL_LISTAR_${sufixo}`, isSystem: false },
    });
    const permissao = await db.permission.upsert({
      where: { code: 'billing.read' },
      create: { code: 'billing.read' },
      update: {},
    });
    await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    await db.userRole.create({ data: { tenantId, userId: usuario.id, roleId: papel.id } });

    const login = await request(servidor()).post('/api/v1/auth/login').send({
      email: usuario.email,
      password: SENHA,
    });
    cookie = cookieDeAcesso(login);
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: tenantId } });
    await app.close();
  });

  it('status invalido responde 400, nao lista vazia', async () => {
    const resposta = await request(servidor())
      .get('/api/v1/invoices')
      .query({ status: 'xyz' })
      .set('Cookie', cookie);

    expect(resposta.status).toBe(400);
    // Distingue de "lista vazia por falta de dado": o corpo tem erro de
    // validacao, nao um envelope de pagina com `total: 0`.
    const corpoInvalido = resposta.body as { total?: number };
    expect(corpoInvalido.total).toBeUndefined();
  });

  it('status valido responde 200 com a pagina', async () => {
    const resposta = await request(servidor())
      .get('/api/v1/invoices')
      .query({ status: 'OPEN' })
      .set('Cookie', cookie);

    expect(resposta.status).toBe(200);
    const corpo = resposta.body as { total: number };
    expect(corpo.total).toBe(0);
  });
});
