import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { comContexto } from '@arenahub/database';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { TurnstileNumberService } from '../../src/modules/students/turnstile-number.service.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Numero de catraca automatico (spec 2026-10-03): o aluno ja nasce com a
 * credencial `FACIAL_ENROLL_ID`, e gerar de novo nunca troca o numero.
 */
describe('numero de catraca automatico', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const conta = { email: `tn-${sufixo}@exemplo.test`, tenantId: '', unidadeId: '', cookie: '' };

  const PERMISSOES = ['student.create', 'student.read', 'student.update'];

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  const montarAcademia = async (
    conta: { email: string; tenantId: string; unidadeId: string; cookie: string },
    slug: string,
  ): Promise<void> => {
    const senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: { slug, legalName: `${slug} LTDA`, displayName: slug },
    });

    const user = await db.user.create({
      data: { email: conta.email, passwordHash: await senhas.gerarHash(SENHA) },
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
      .send({ email: conta.email, password: SENHA });

    conta.tenantId = tenant.id;
    conta.unidadeId = unidade.id;
    conta.cookie = cookieDeAcesso(login);
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

  const criarAluno = async (c: typeof conta): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', c.cookie)
      .send({
        fullName: 'Aluno De Teste',
        birthDate: '2000-05-10',
        gymUnitId: c.unidadeId,
        cpf: gerarCpfValido(),
        contacts: [],
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  // Chamada direta ao service, fora de requisicao: abre o escopo de RLS.
  const como = <T>(fn: () => Promise<T>): Promise<T> =>
    comContexto({ kind: 'tenant', tenantId: conta.tenantId }, fn);

  const contextoDe = (tenantId: string): TenantContext => ({
    tenantId,
    actorId: 'teste',
    sessionId: 'teste',
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    await montarAcademia(conta, `tn-${sufixo}`);
  });

  afterAll(async () => {
    // Suite que cria tenant apaga o tenant: o cascade leva alunos e credenciais.
    if (conta.tenantId) {
      await db.tenant.delete({ where: { id: conta.tenantId } }).catch(() => undefined);
    }
    await db.user.deleteMany({ where: { email: conta.email } });
    await app?.close();
  });

  it('cadastro do aluno ja nasce com numero de catraca na faixa', async () => {
    const id = await criarAluno(conta);
    const r = await request(servidor())
      .get(`/api/v1/students/${id}/credentials`)
      .set('Cookie', conta.cookie);
    const facial = (r.body as { kind: string; externalId: string }[]).find(
      (c) => c.kind === 'FACIAL_ENROLL_ID',
    );
    expect(facial).toBeDefined();
    expect(Number(facial!.externalId)).toBeGreaterThanOrEqual(100_000_000_000);
  });

  it('gerar de novo para o mesmo aluno devolve o mesmo numero', async () => {
    const id = await criarAluno(conta);
    const servico = app.get(TurnstileNumberService);
    const ctx = contextoDe(conta.tenantId);
    const primeiro = await como(() => servico.gerar(ctx, id));
    const segundo = await como(() => servico.gerar(ctx, id));
    expect(segundo).toEqual({ externalId: primeiro.externalId, created: false });
  });

  it('duas geracoes em paralelo para alunos diferentes nao repetem numero', async () => {
    const [a, b] = await Promise.all([criarAluno(conta), criarAluno(conta)]);
    await db.studentCredential.deleteMany({ where: { studentId: { in: [a, b] } } });
    const servico = app.get(TurnstileNumberService);
    const ctx = contextoDe(conta.tenantId);
    const [ra, rb] = await Promise.all([
      como(() => servico.gerar(ctx, a)),
      como(() => servico.gerar(ctx, b)),
    ]);
    expect(ra.externalId).not.toBe(rb.externalId);
  });
});
