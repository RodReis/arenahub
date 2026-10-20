import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PERMISSOES_DA_RECEPCAO } from '@arenahub/database';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * A RECEPCAO recebe no balcao com Vencimento e Cobertura ate editados (#650,
 * #654). O que so o HTTP prova: com EXATAMENTE as permissoes do perfil
 * (`PERMISSOES_DA_RECEPCAO`), a rota do lote aceita as duas datas e as grava.
 * O PI relatou que a recepcao "nao tinha acesso a alterar a data".
 */
describe('recepcao recebe no balcao com vencimento e cobertura editados (HTTP)', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-recepcao';
  const PRECO_MINOR = 15_000;
  const cenario = { tenantId: '', subscriptionId: '', cookieRecepcao: '' };

  const servidor = (): Parameters<typeof request>[0] => app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  /** 'YYYY-MM-DD' de hoje (UTC, o mesmo dia que a API usa) somado a `dias`. */
  const diaEm = (dias: number): string =>
    new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();
    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: { slug: `rec-${sufixo}`, legalName: `Recepcao ${sufixo} LTDA`, displayName: `Recepcao ${sufixo}` },
    });
    cenario.tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: `UNI-${sufixo}`,
        name: 'Unidade da fixture',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    const plano = await db.plan.create({ data: { tenantId: tenant.id, name: `Plano ${sufixo}` } });
    await db.planPrice.create({
      data: {
        tenantId: tenant.id,
        planId: plano.id,
        amountMinor: PRECO_MINOR,
        validFrom: new Date('2026-01-01T00:00:00Z'),
      },
    });
    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        fullName: 'Aluno Recepcao',
        membershipNumber: `rec-${sufixo}`,
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
    cenario.subscriptionId = assinatura.id;
    await db.billingSettings.create({ data: { tenantId: tenant.id, dueDay: 10, graceDays: 5 } });

    const usuario = await db.user.create({
      data: {
        email: `rec-${sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash(SENHA),
      },
    });
    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: usuario.id } });
    const papel = await db.role.create({
      data: { tenantId: tenant.id, name: `RECEPCAO_${sufixo}`, isSystem: false },
    });
    for (const code of PERMISSOES_DA_RECEPCAO) {
      const permissao = await db.permission.upsert({ where: { code }, create: { code }, update: {} });
      await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    }
    await db.userRole.create({ data: { tenantId: tenant.id, userId: usuario.id, roleId: papel.id } });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: usuario.email, password: SENHA });
    cenario.cookieRecepcao = cookieDeAcesso(login);
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: cenario.tenantId } });
    await db.user.deleteMany({ where: { email: { contains: `rec-${sufixo}` } } });
    await app.close();
  });

  it('o perfil da recepcao so nao tem o painel financeiro (premissa do teste)', () => {
    expect(PERMISSOES_DA_RECEPCAO).toContain('billing.payment.manual');
    expect(PERMISSOES_DA_RECEPCAO).not.toContain('billing.dashboard');
  });

  it('lista os meses pagaveis e recebe gravando o vencimento e a cobertura que digitou', async () => {
    const meses = await request(servidor())
      .get(`/api/v1/subscriptions/${cenario.subscriptionId}/payable-months`)
      .set('Cookie', cenario.cookieRecepcao);

    expect(meses.status).toBe(200);
    const competencia = (meses.body as { months: { competencia: string }[] }).months[0]!.competencia.slice(0, 7);

    const hoje = diaEm(0);
    const resposta = await request(servidor())
      .post(`/api/v1/subscriptions/${cenario.subscriptionId}/manual-payment-batch`)
      .set('Cookie', cenario.cookieRecepcao)
      .set('Idempotency-Key', randomUUID())
      .send({
        competencias: [competencia],
        paidAt: hoje,
        channel: 'DINHEIRO',
        expectedTotalMinor: PRECO_MINOR,
        vencimento: diaEm(3),
        coberturaAte: diaEm(40),
      });

    expect(resposta.status).toBe(201);

    const invoice = await db.invoice.findFirstOrThrow({
      where: { tenantId: cenario.tenantId, subscriptionId: cenario.subscriptionId },
    });
    expect(invoice.status).toBe('PAID');
    expect(invoice.dueAt.toISOString().slice(0, 10)).toBe(diaEm(3));
    expect(invoice.coverageEndsAt?.toISOString().slice(0, 10)).toBe(diaEm(40));
  });
});
