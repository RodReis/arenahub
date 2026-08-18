import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F12 -- endpoints do financeiro (Slice 2.1).
 *
 * O foco aqui e o que SO o HTTP prova:
 *
 *   - `billing.payment.manual` e permissao SEPARADA de `billing.manage`.
 *     Quem administra cobranca nao reconhece dinheiro no balcao por
 *     tabela -- e decisao desta fatia, entao precisa de teste, senao a
 *     separacao existe so no comentario;
 *   - o Zod recusa valor fracionario ANTES do dominio (INV-065);
 *   - abrir a mesma invoice duas vezes pelo endpoint devolve o mesmo
 *     numero (clique duplo nao cobra duas vezes).
 */
describe('F12 -- endpoints de invoice e pagamento manual', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-financeiro';
  const PRECO_MINOR = 15_000;

  const cenario = {
    tenantId: '',
    subscriptionId: '',
    studentId: '',
    /** Tem `billing.read` + `billing.manage`, NAO tem o pagamento manual. */
    cookieGestor: '',
    /** Tem os tres. */
    cookieCaixa: '',
  };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  /** Cria usuario com exatamente as permissoes pedidas e devolve o cookie. */
  async function criarUsuarioCom(
    rotulo: string,
    codigos: readonly string[],
  ): Promise<{ id: string; cookie: string }> {
    const usuario = await db.user.create({
      data: {
        email: `f12-${rotulo}-${sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash(SENHA),
      },
    });

    await db.tenantMembership.create({
      data: { tenantId: cenario.tenantId, userId: usuario.id },
    });

    const papel = await db.role.create({
      data: { tenantId: cenario.tenantId, name: `PAPEL_${rotulo}_${sufixo}`, isSystem: false },
    });

    for (const code of codigos) {
      const permissao = await db.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });

      await db.rolePermission.create({
        data: { roleId: papel.id, permissionId: permissao.id },
      });
    }

    await db.userRole.create({
      data: { tenantId: cenario.tenantId, userId: usuario.id, roleId: papel.id },
    });

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

    const tenant = await db.tenant.create({
      data: {
        slug: `f12-${sufixo}`,
        legalName: `Financeiro ${sufixo} LTDA`,
        displayName: `Financeiro ${sufixo}`,
      },
    });
    cenario.tenantId = tenant.id;

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Plano F12 ${sufixo}` },
    });

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
        fullName: 'Aluno F12',
        membershipNumber: `f12-${sufixo}`,
        birthDate: new Date('1990-05-20T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
    cenario.studentId = aluno.id;

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

    await db.billingSettings.create({
      data: { tenantId: tenant.id, dueDay: 10, graceDays: 5 },
    });

    const gestor = await criarUsuarioCom('gestor', ['billing.read', 'billing.manage']);
    cenario.cookieGestor = gestor.cookie;

    const caixa = await criarUsuarioCom('caixa', [
      'billing.read',
      'billing.manage',
      'billing.payment.manual',
    ]);
    cenario.cookieCaixa = caixa.cookie;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: cenario.tenantId } });
    await db.user.deleteMany({ where: { email: { contains: `f12-` } } });
    await app.close();
  });

  it('abre a invoice pelo endpoint', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/invoices')
      .set('Cookie', cenario.cookieGestor)
      .send({ subscriptionId: cenario.subscriptionId, emQue: '2026-08-18T12:00:00.000Z' });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({
      status: 'OPEN',
      number: 1,
      totalMinor: PRECO_MINOR,
    });
  });

  it('abrir de novo devolve o MESMO numero -- clique duplo nao cobra duas vezes', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/invoices')
      .set('Cookie', cenario.cookieGestor)
      .send({ subscriptionId: cenario.subscriptionId, emQue: '2026-08-25T09:00:00.000Z' });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ number: 1 });
  });

  it('quem tem billing.manage mas NAO billing.payment.manual e barrado', async () => {
    const invoice = await db.invoice.findFirstOrThrow({ where: { tenantId: cenario.tenantId } });

    const resposta = await request(servidor())
      .post(`/api/v1/invoices/${invoice.id}/manual-payment`)
      .set('Cookie', cenario.cookieGestor)
      .send({
        amountMinor: PRECO_MINOR,
        paidAt: '2026-08-09T10:00:00.000Z',
        reason: 'tentativa sem permissao',
      });

    expect(resposta.status).toBe(403);
  });

  it('valor fracionario e recusado pelo Zod antes do dominio (INV-065)', async () => {
    const invoice = await db.invoice.findFirstOrThrow({ where: { tenantId: cenario.tenantId } });

    const resposta = await request(servidor())
      .post(`/api/v1/invoices/${invoice.id}/manual-payment`)
      .set('Cookie', cenario.cookieCaixa)
      .send({
        amountMinor: 150.5,
        paidAt: '2026-08-09T10:00:00.000Z',
        reason: 'valor com centavo fracionario',
      });

    expect(resposta.status).toBe(400);
  });

  it('o caixa registra o pagamento e a invoice fica paga', async () => {
    const invoice = await db.invoice.findFirstOrThrow({ where: { tenantId: cenario.tenantId } });

    const resposta = await request(servidor())
      .post(`/api/v1/invoices/${invoice.id}/manual-payment`)
      .set('Cookie', cenario.cookieCaixa)
      .send({
        amountMinor: PRECO_MINOR,
        paidAt: '2026-08-09T10:00:00.000Z',
        reason: 'dinheiro na recepcao',
      });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ status: 'PAID' });

    const corpo = resposta.body as { payments: { recognizedByUserId: string | null }[] };
    expect(corpo.payments).toHaveLength(1);
    // A mitigacao detectiva: o dinheiro manual fica ligado a uma pessoa.
    expect(corpo.payments[0]?.recognizedByUserId).not.toBeNull();
  });

  it('lista as invoices do aluno', async () => {
    const resposta = await request(servidor())
      .get(`/api/v1/students/${cenario.studentId}/invoices`)
      .set('Cookie', cenario.cookieGestor);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toHaveLength(1);
  });
});
