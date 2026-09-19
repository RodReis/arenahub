import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F76 (SPEC-076, ADR-059/ADR-060) -- limite mensal de convidados por
 * assinatura, provado pela porta da frente.
 *
 * O que este arquivo existe para provar, e que teste unitario nao alcanca:
 *
 *   - a recusa acima do limite sob CONCORRENCIA real (a trava e o motivo de
 *     existir);
 *   - isolamento entre tenants (INV-006);
 *   - o convidado registrado grava nome e CPF, nao um contador solto.
 */
describe('F76 -- convidados no plano', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const conta = {
    email: `f76-a-${sufixo}@exemplo.test`,
    tenantId: '',
    userId: '',
    unidadeId: '',
    cookie: '',
  };

  const outraConta = {
    email: `f76-b-${sufixo}@exemplo.test`,
    tenantId: '',
    userId: '',
    unidadeId: '',
    cookie: '',
  };

  const PERMISSOES = [
    'student.create',
    'student.read',
    'plan.manage',
    'plan.read',
    'subscription.manage',
  ];

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  const montarAcademia = async (
    alvo: typeof conta,
    slug: string,
  ): Promise<void> => {
    const senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: { slug, legalName: `${slug} LTDA`, displayName: slug },
    });

    const user = await db.user.create({
      data: { email: alvo.email, passwordHash: await senhas.gerarHash(SENHA) },
    });

    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id } });

    const papel = await db.role.create({
      data: { tenantId: tenant.id, name: 'OWNER', isSystem: true },
    });

    const permissoes = await Promise.all(
      PERMISSOES.map((code) =>
        db.permission.upsert({ where: { code }, create: { code }, update: {} }),
      ),
    );

    await db.rolePermission.createMany({
      data: permissoes.map((p) => ({ roleId: papel.id, permissionId: p.id })),
    });

    await db.userRole.create({
      data: { tenantId: tenant.id, userId: user.id, roleId: papel.id },
    });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'CENTRO',
        name: `Centro ${slug}`,
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: alvo.email, password: SENHA });

    alvo.tenantId = tenant.id;
    alvo.userId = user.id;
    alvo.unidadeId = unidade.id;
    alvo.cookie = cookieDeAcesso(login);
  };

  let proximoCpf = 1;
  const gerarCpfValido = (): string => {
    const base = String(100000000 + ((proximoCpf * 97) % 899999999)).padStart(9, '0');
    proximoCpf += 1;

    const digitos = base.split('').map(Number);
    const verificador = (ate: number, seq: number[]): number => {
      let soma = 0;
      for (let i = 0; i < ate; i += 1) soma += seq[i]! * (ate + 1 - i);
      const resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
    };
    const d1 = verificador(9, digitos);
    const d2 = verificador(10, [...digitos, d1]);

    return `${base}${d1}${d2}`;
  };

  const criarAluno = async (alvo: typeof conta): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', alvo.cookie)
      .send({
        fullName: 'Aluno De Teste F76',
        birthDate: '2000-05-10',
        gymUnitId: alvo.unidadeId,
        cpf: gerarCpfValido(),
        contacts: [],
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  /** Plano com limite de convidados; `guestPassesPerMonth` sobrescrevivel. */
  const criarPlano = async (
    alvo: typeof conta,
    guestPassesPerMonth: number | undefined,
  ): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/plans')
      .set('Cookie', alvo.cookie)
      .send({
        name: `Mensal F76 ${randomUUID().slice(0, 6)}`,
        gymUnitIds: [alvo.unidadeId],
        janelas: [
          { gymUnitId: alvo.unidadeId, dayOfWeek: 1, startMinute: 360, endMinute: 1320 },
        ],
        amountMinor: 15000,
        ...(guestPassesPerMonth === undefined ? {} : { guestPassesPerMonth }),
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  const criarAssinatura = async (
    alvo: typeof conta,
    studentId: string,
    planId: string,
  ): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/subscriptions')
      .set('Cookie', alvo.cookie)
      .send({
        studentId,
        planId,
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-10-01T00:00:00.000Z',
        reason: 'teste F76',
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { subscriptionId: string }).subscriptionId;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    await montarAcademia(conta, `f76-rede-a-${sufixo}`);
    await montarAcademia(outraConta, `f76-rede-b-${sufixo}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registra convidado com nome e CPF sob assinatura com limite', async () => {
    const studentId = await criarAluno(conta);
    const planId = await criarPlano(conta, 2);
    const subscriptionId = await criarAssinatura(conta, studentId, planId);

    const resposta = await request(servidor())
      .post(`/api/v1/subscriptions/${subscriptionId}/guest-passes`)
      .set('Cookie', conta.cookie)
      .send({ guestName: 'Convidado Um', guestCpf: gerarCpfValido() });

    expect(resposta.status).toBe(201);
    expect((resposta.body as { guestName: string }).guestName).toBe('Convidado Um');
  });

  it('recusa registrar convidado quando plano nao tem o beneficio', async () => {
    const studentId = await criarAluno(conta);
    const planId = await criarPlano(conta, undefined);
    const subscriptionId = await criarAssinatura(conta, studentId, planId);

    const resposta = await request(servidor())
      .post(`/api/v1/subscriptions/${subscriptionId}/guest-passes`)
      .set('Cookie', conta.cookie)
      .send({ guestName: 'Sem Beneficio', guestCpf: gerarCpfValido() });

    expect(resposta.status).toBe(422);
    expect((resposta.body as { code: string }).code).toBe('GUEST_PASS_NOT_INCLUDED');
  });

  it('recusa o CPF invalido do convidado', async () => {
    const studentId = await criarAluno(conta);
    const planId = await criarPlano(conta, 2);
    const subscriptionId = await criarAssinatura(conta, studentId, planId);

    const resposta = await request(servidor())
      .post(`/api/v1/subscriptions/${subscriptionId}/guest-passes`)
      .set('Cookie', conta.cookie)
      .send({ guestName: 'CPF Invalido', guestCpf: '111.111.111-11' });

    expect(resposta.status).toBe(422);
  });

  it('recusa acima do limite mensal, mesmo sob concorrencia', async () => {
    const studentId = await criarAluno(conta);
    const planId = await criarPlano(conta, 2);
    const subscriptionId = await criarAssinatura(conta, studentId, planId);

    // 5 pedidos simultaneos, limite 2: sem a trava, a corrida deixaria mais
    // de 2 linhas gravadas -- e e exatamente o que este teste prova que nao
    // acontece.
    const respostas = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(servidor())
          .post(`/api/v1/subscriptions/${subscriptionId}/guest-passes`)
          .set('Cookie', conta.cookie)
          .send({ guestName: `Convidado ${i}`, guestCpf: gerarCpfValido() }),
      ),
    );

    const aceitos = respostas.filter((r) => r.status === 201);
    const recusados = respostas.filter((r) => r.status === 409);

    expect(aceitos.length).toBe(2);
    expect(recusados.length).toBe(3);

    const gravados = await db.guestPass.count({ where: { subscriptionId } });
    expect(gravados).toBe(2);
  });

  it('reseta o limite no mes-calendario seguinte', async () => {
    const studentId = await criarAluno(conta);
    const planId = await criarPlano(conta, 1);
    const subscriptionId = await criarAssinatura(conta, studentId, planId);

    // Usa o unico passe deste mes diretamente no banco, com `usedAt` no mes
    // anterior -- e o comportamento visivel que a decisao do PI (18/09/2026,
    // mes-calendario) promete: o registro de agosto nao consome o limite de
    // setembro.
    await db.guestPass.create({
      data: {
        tenantId: conta.tenantId,
        subscriptionId,
        guestName: 'Do Mes Passado',
        guestCpf: gerarCpfValido(),
        usedAt: new Date('2026-08-15T12:00:00.000Z'),
      },
    });

    const resposta = await request(servidor())
      .post(`/api/v1/subscriptions/${subscriptionId}/guest-passes`)
      .set('Cookie', conta.cookie)
      .send({ guestName: 'Deste Mes', guestCpf: gerarCpfValido() });

    expect(resposta.status).toBe(201);
  });

  it('recusa registrar convidado em assinatura de outro tenant', async () => {
    const studentId = await criarAluno(outraConta);
    const planId = await criarPlano(outraConta, 2);
    const subscriptionId = await criarAssinatura(outraConta, studentId, planId);

    const resposta = await request(servidor())
      .post(`/api/v1/subscriptions/${subscriptionId}/guest-passes`)
      .set('Cookie', conta.cookie)
      .send({ guestName: 'Cruzado', guestCpf: gerarCpfValido() });

    expect(resposta.status).toBe(404);
  });

  it('lista o historico de convidados da assinatura', async () => {
    const studentId = await criarAluno(conta);
    const planId = await criarPlano(conta, 2);
    const subscriptionId = await criarAssinatura(conta, studentId, planId);

    await request(servidor())
      .post(`/api/v1/subscriptions/${subscriptionId}/guest-passes`)
      .set('Cookie', conta.cookie)
      .send({ guestName: 'Listado Um', guestCpf: gerarCpfValido() });

    const resposta = await request(servidor())
      .get(`/api/v1/subscriptions/${subscriptionId}/guest-passes`)
      .set('Cookie', conta.cookie);

    expect(resposta.status).toBe(200);
    expect((resposta.body as { guestName: string }[]).map((g) => g.guestName)).toEqual([
      'Listado Um',
    ]);
  });
});
