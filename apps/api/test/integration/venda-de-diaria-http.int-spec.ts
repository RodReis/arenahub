import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import {
  apagarCenario,
  criarAluno,
  criarCenarioDeDiaria,
  criarPlano,
  type CenarioDeDiaria,
} from './helpers/cenario-de-diaria.js';

/**
 * F86 -- o que SO o HTTP prova: a rota exige as DUAS permissoes (vender diaria e
 * receber dinheiro sao atos diferentes, e quem tem so uma nao passa), e o Zod
 * recusa valor fracionario ANTES do dominio (INV-065).
 */
describe('F86 -- POST /students/:id/day-pass', () => {
  let app: INestApplication;
  let db: PrismaService;
  let c: CenarioDeDiaria;
  let planId = '';
  let studentId = '';

  const SENHA = 'senha-de-teste-diaria';
  const cookies = { completo: '', soAtribui: '', soCaixa: '' };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((x) => x.startsWith('arenahub_access=')) ?? '';
  };

  async function usuarioCom(rotulo: string, codigos: readonly string[]): Promise<string> {
    const usuario = await db.user.create({
      data: {
        email: `diaria-http-${rotulo}-${c.sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash(SENHA),
      },
    });
    await db.tenantMembership.create({ data: { tenantId: c.tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId: c.tenantId, name: `PAPEL_${rotulo}_${c.sufixo}`, isSystem: false },
    });

    for (const code of codigos) {
      const permissao = await db.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });
      await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    }

    await db.userRole.create({
      data: { tenantId: c.tenantId, userId: usuario.id, roleId: papel.id },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: usuario.email, password: SENHA });

    return cookieDeAcesso(login);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();
    db = app.get(PrismaService);

    c = await criarCenarioDeDiaria(db, app.get(PasswordService));
    planId = await criarPlano(db, c, { nome: `Diaria http ${c.sufixo}` });
    studentId = await criarAluno(db, c);

    cookies.completo = await usuarioCom('completo', [
      'subscription.manage',
      'billing.payment.manual',
    ]);
    cookies.soAtribui = await usuarioCom('so-atribui', ['subscription.manage']);
    cookies.soCaixa = await usuarioCom('so-caixa', ['billing.payment.manual']);
  });

  afterAll(async () => {
    await apagarCenario(db, c);
    await db.user.deleteMany({ where: { email: { contains: `diaria-http-` } } });
    await app.close();
  });

  const corpo = () => ({ planId, channel: 'DINHEIRO', expectedTotalMinor: 3000 });

  it('quem so tem subscription.manage e barrado', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/day-pass`)
      .set('Cookie', cookies.soAtribui)
      .send(corpo());

    expect(resposta.status).toBe(403);
  });

  it('quem so tem billing.payment.manual e barrado', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/day-pass`)
      .set('Cookie', cookies.soCaixa)
      .send(corpo());

    expect(resposta.status).toBe(403);
  });

  it('valor fracionario e recusado pelo Zod antes do dominio (INV-065)', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/day-pass`)
      .set('Cookie', cookies.completo)
      .send({ ...corpo(), expectedTotalMinor: 30.5 });

    expect(resposta.status).toBe(400);
  });

  it('id de aluno que nao e UUID e recusado antes de tocar no banco', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/nao-e-uuid/day-pass`)
      .set('Cookie', cookies.completo)
      .send(corpo());

    expect(resposta.status).toBe(400);
  });

  it('corpo com campo desconhecido e recusado (strict)', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/day-pass`)
      .set('Cookie', cookies.completo)
      .send({ ...corpo(), tenantId: randomUUID() });

    expect(resposta.status).toBe(400);
  });

  it('com as duas permissoes, vende: 201 e o direito fica ativo', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/day-pass`)
      .set('Cookie', cookies.completo)
      .send(corpo());

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({
      subscriptionId: expect.any(String),
      invoiceId: expect.any(String),
      paymentId: expect.any(String),
    });

    const direito = await db.entitlement.findFirstOrThrow({
      where: { tenantId: c.tenantId, studentId },
    });
    expect(direito.status).toBe('ACTIVE');
    expect(new Date((resposta.body as { endsAt: string }).endsAt).getTime()).toBe(direito.endsAt.getTime());
  });

  it('segunda venda para o mesmo aluno no mesmo dia: 409 com codigo estavel', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/day-pass`)
      .set('Cookie', cookies.completo)
      .send(corpo());

    expect(resposta.status).toBe(409);
    expect(resposta.body).toMatchObject({ code: 'STUDENT_HAS_ACTIVE_SUBSCRIPTION' });
  });
});
