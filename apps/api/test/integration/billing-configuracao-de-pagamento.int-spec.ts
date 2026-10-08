import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { ConfiguracaoDePagamentoUseCase } from '../../src/modules/billing/configuracao-de-pagamento.use-case.js';
import type { ConfiguracaoDePagamento } from '../../src/modules/billing/domain/configuracao-de-pagamento.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';

/**
 * F89 -- configuracao de pagamento do tenant (dia de gerar, dia de vencer,
 * dias de bloqueio).
 *
 * Contra banco de verdade: o que importa aqui e (a) ler nao grava, (b) salvar
 * grava a linha e a auditoria na mesma transacao, (c) salvar NUNCA toca em
 * `Invoice` (so parcelas futuras) e (d) o CHECK do banco segura quem escreve
 * por fora do caso de uso.
 */
describe('F89 -- configuracao de pagamento', () => {
  let app: INestApplication;
  let db: PrismaService;
  let useCase: ConfiguracaoDePagamentoUseCase;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-f89';
  const PADRAO: ConfiguracaoDePagamento = { invoiceGenerationDay: 1, dueDay: 10, graceDays: 5 };

  let tenantSemLinha = '';
  let tenantId = '';
  let gymUnitId = '';
  let atorId = '';
  let cookieDono = '';
  let cookieFinanceiro = '';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const contextoDe = (tenant: string): TenantContext => ({
    tenantId: tenant,
    actorId: atorId,
    sessionId: 'sessao-de-teste',
    permissions: new Set(['billing.settings.manage']),
    allowedUnitIds: 'ALL',
  });

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  const auditorias = (tenant: string): Promise<{ metadata: unknown }[]> =>
    db.auditLog.findMany({
      where: { tenantId: tenant, action: 'billing.settings_updated' },
      orderBy: { occurredAt: 'asc' },
      select: { metadata: true },
    });

  async function criarUsuarioCom(
    rotulo: string,
    codigos: readonly string[],
  ): Promise<{ id: string; cookie: string }> {
    const usuario = await db.user.create({
      data: {
        email: `f89-${rotulo}-${sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash(SENHA),
      },
    });
    await db.tenantMembership.create({ data: { tenantId, userId: usuario.id } });
    const papel = await db.role.create({
      data: { tenantId, name: `PAPEL_${rotulo}_${sufixo}`, isSystem: false },
    });

    for (const code of codigos) {
      const permissao = await db.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });
      await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    }

    await db.userRole.create({ data: { tenantId, userId: usuario.id, roleId: papel.id } });
    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: usuario.email, password: SENHA });

    return { id: usuario.id, cookie: cookieDeAcesso(login) };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);
    useCase = comContextoDeTenant(app.get(ConfiguracaoDePagamentoUseCase));

    const [semLinha, comLinha] = await Promise.all(
      ['sem', 'com'].map((rotulo) =>
        db.tenant.create({
          data: {
            slug: `f89-${rotulo}-${sufixo}`,
            legalName: `Config Pagamento ${rotulo} ${sufixo} LTDA`,
            displayName: `Config Pagamento ${rotulo} ${sufixo}`,
          },
        }),
      ),
    );
    tenantSemLinha = semLinha!.id;
    tenantId = comLinha!.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: 'SP',
        name: 'Sao Paulo',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    gymUnitId = unidade.id;

    const dono = await criarUsuarioCom('dono', ['billing.read', 'billing.settings.manage']);
    atorId = dono.id;
    cookieDono = dono.cookie;
    // Financeiro: le e administra cobranca, mas NAO mexe na configuracao.
    cookieFinanceiro = (await criarUsuarioCom('financeiro', ['billing.read', 'billing.manage'])).cookie;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [tenantId, tenantSemLinha] } } });
    await db.user.deleteMany({ where: { email: { contains: `f89-` } } });
    await app.close();
  });

  it('GET sem linha devolve 1/10/5 e NAO cria a linha', async () => {
    expect(await useCase.obter(tenantSemLinha)).toEqual(PADRAO);
    expect(await db.billingSettings.count({ where: { tenantId: tenantSemLinha } })).toBe(0);
  });

  it('PUT cria a linha quando nao existe e devolve o que gravou', async () => {
    const entrada = { invoiceGenerationDay: 2, dueDay: 8, graceDays: 4 };

    expect(await useCase.salvar(contextoDe(tenantSemLinha), entrada, 'corr-1')).toEqual(entrada);

    expect(await db.billingSettings.count({ where: { tenantId: tenantSemLinha } })).toBe(1);
    expect(await useCase.obter(tenantSemLinha)).toEqual(entrada);
  });

  it('PUT grava auditoria billing.settings_updated com antigo e novo', async () => {
    // A linha ja existe (dueDay/graceDays vieram do default da coluna).
    await db.billingSettings.create({ data: { tenantId } });
    const novo = { invoiceGenerationDay: 3, dueDay: 12, graceDays: 3 };

    await useCase.salvar(contextoDe(tenantId), novo, 'corr-audit');

    const log = await db.auditLog.findFirstOrThrow({
      where: { tenantId, action: 'billing.settings_updated' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(log.metadata).toEqual({ before: PADRAO, after: novo });
    expect(log).toMatchObject({
      actorType: 'USER',
      actorId: atorId,
      target: 'BillingSettings',
      targetId: tenantId,
      correlationId: 'corr-audit',
    });
  });

  it('PUT NAO altera fatura aberta (dueAt e blockAt congelados)', async () => {
    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: `F89-${sufixo}`,
        fullName: 'Aluno F89',
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    const plano = await db.plan.create({ data: { tenantId, name: `Plano F89 ${sufixo}` } });
    const assinatura = await db.subscription.create({
      data: {
        tenantId,
        studentId: aluno.id,
        planId: plano.id,
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    const aberta = await db.invoice.create({
      data: {
        tenantId,
        subscriptionId: assinatura.id,
        studentId: aluno.id,
        billingPeriod: new Date('2026-11-01T00:00:00Z'),
        status: 'OPEN',
        number: 1,
        subtotalMinor: 10000,
        totalMinor: 10000,
        dueAt: new Date('2026-11-10T00:00:00Z'),
        blockAt: new Date('2026-11-15T03:00:00Z'),
      },
    });

    await useCase.salvar(contextoDe(tenantId), { invoiceGenerationDay: 5, dueDay: 20, graceDays: 10 }, 'corr-inv');

    const depois = await db.invoice.findUniqueOrThrow({ where: { id: aberta.id } });
    expect(depois.dueAt).toEqual(aberta.dueAt);
    expect(depois.blockAt).toEqual(aberta.blockAt);
    expect(depois.version).toBe(aberta.version);
    expect(depois.updatedAt).toEqual(aberta.updatedAt);
  });

  it.each([
    ['gerar maior que vencer', { invoiceGenerationDay: 15, dueDay: 10, graceDays: 5 }],
    ['vencer 29', { invoiceGenerationDay: 1, dueDay: 29, graceDays: 5 }],
    ['gerar 0', { invoiceGenerationDay: 0, dueDay: 10, graceDays: 5 }],
    ['bloqueio 0', { invoiceGenerationDay: 1, dueDay: 10, graceDays: 0 }],
    ['bloqueio 31', { invoiceGenerationDay: 1, dueDay: 10, graceDays: 31 }],
    ['fracionario', { invoiceGenerationDay: 1, dueDay: 10.5, graceDays: 5 }],
  ])('PUT recusa %s e nao grava nada', async (_nome, entrada) => {
    const linhaAntes = await db.billingSettings.findUnique({ where: { tenantId } });
    const logsAntes = await auditorias(tenantId);

    await expect(useCase.salvar(contextoDe(tenantId), entrada, 'corr-x')).rejects.toMatchObject({
      code: 'BILLING_SETTINGS_INVALID',
    });

    expect(await db.billingSettings.findUnique({ where: { tenantId } })).toEqual(linhaAntes);
    expect(await auditorias(tenantId)).toEqual(logsAntes);
  });

  it('duas gravacoes em sequencia valem a ultima e geram duas auditorias', async () => {
    const logsAntes = (await auditorias(tenantId)).length;
    const primeira = { invoiceGenerationDay: 4, dueDay: 14, graceDays: 2 };
    const segunda = { invoiceGenerationDay: 6, dueDay: 16, graceDays: 7 };

    await useCase.salvar(contextoDe(tenantId), primeira, 'corr-a');
    await useCase.salvar(contextoDe(tenantId), segunda, 'corr-b');

    expect(await useCase.obter(tenantId)).toEqual(segunda);
    const logs = await auditorias(tenantId);
    expect(logs).toHaveLength(logsAntes + 2);
    expect(logs.at(-1)?.metadata).toEqual({ before: primeira, after: segunda });
  });

  it('o banco recusa escrita direta fora dos limites (CHECK)', async () => {
    await useCase.salvar(contextoDe(tenantId), PADRAO, 'corr-check');

    // gerar 20 > vencer 10
    await expect(
      db.billingSettings.update({ where: { tenantId }, data: { invoiceGenerationDay: 20 } }),
    ).rejects.toThrow();
    // vencer 29
    await expect(db.billingSettings.update({ where: { tenantId }, data: { dueDay: 29 } })).rejects.toThrow();
    // bloqueio 31
    await expect(db.billingSettings.update({ where: { tenantId }, data: { graceDays: 31 } })).rejects.toThrow();

    expect(await useCase.obter(tenantId)).toEqual(PADRAO);
  });

  describe('HTTP', () => {
    const corpoValido = { invoiceGenerationDay: 2, dueDay: 9, graceDays: 6 };

    it('GET /api/v1/billing/settings devolve a configuracao para quem tem billing.read', async () => {
      const resposta = await request(servidor())
        .get('/api/v1/billing/settings')
        .set('Cookie', cookieFinanceiro);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual(await useCase.obter(tenantId));
    });

    it('OWNER (billing.settings.manage) salva com 200', async () => {
      const resposta = await request(servidor())
        .put('/api/v1/billing/settings')
        .set('Cookie', cookieDono)
        .send(corpoValido);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual(corpoValido);
      expect(await useCase.obter(tenantId)).toEqual(corpoValido);
    });

    it('financeiro (billing.manage, sem billing.settings.manage) recebe 403 e nada muda', async () => {
      const antes = await db.billingSettings.findUnique({ where: { tenantId } });
      const logsAntes = (await auditorias(tenantId)).length;

      const resposta = await request(servidor())
        .put('/api/v1/billing/settings')
        .set('Cookie', cookieFinanceiro)
        .send({ invoiceGenerationDay: 1, dueDay: 28, graceDays: 30 });

      expect(resposta.status).toBe(403);
      expect(await db.billingSettings.findUnique({ where: { tenantId } })).toEqual(antes);
      expect(await auditorias(tenantId)).toHaveLength(logsAntes);
    });

    it('sem login recebe 401', async () => {
      const resposta = await request(servidor()).put('/api/v1/billing/settings').send(corpoValido);

      expect(resposta.status).toBe(401);
    });

    it.each([
      ['dia como string', { invoiceGenerationDay: 2, dueDay: '10', graceDays: 5 }],
      ['campo faltando', { invoiceGenerationDay: 2, dueDay: 10 }],
      ['fracionario', { invoiceGenerationDay: 2, dueDay: 10.5, graceDays: 5 }],
      ['nulo', { invoiceGenerationDay: 2, dueDay: null, graceDays: 5 }],
      ['campo desconhecido', { ...corpoValido, extra: 1 }],
    ])('corpo malformado (%s) e recusado com 400 e nada e gravado', async (_nome, corpo) => {
      const antes = await db.billingSettings.findUnique({ where: { tenantId } });
      const logsAntes = (await auditorias(tenantId)).length;

      const resposta = await request(servidor())
        .put('/api/v1/billing/settings')
        .set('Cookie', cookieDono)
        .send(corpo);

      expect(resposta.status).toBe(400);
      expect(await db.billingSettings.findUnique({ where: { tenantId } })).toEqual(antes);
      expect(await auditorias(tenantId)).toHaveLength(logsAntes);
    });

    it('valor fora do limite vira 422 BILLING_SETTINGS_INVALID', async () => {
      const resposta = await request(servidor())
        .put('/api/v1/billing/settings')
        .set('Cookie', cookieDono)
        .send({ invoiceGenerationDay: 15, dueDay: 10, graceDays: 5 });

      expect(resposta.status).toBe(422);
      expect(resposta.body).toMatchObject({ code: 'BILLING_SETTINGS_INVALID' });
    });
  });
});
