import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F81 (issue #415) -- `TeamController`, provado pela porta da frente.
 *
 * O que este arquivo existe para provar: a listagem so devolve
 * `profile != STUDENT` com `X-Total-Count`, o `PATCH /employment` grava sob
 * trava otimista (200 e 409), a agenda devolve array, e isolamento entre
 * tenants (404, nunca 403).
 */
describe('TeamController (F81)', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: { email: `f81-a-${sufixo}@exemplo.test`, tenantId: '', unidadeId: '', cookie: '' },
    b: { email: `f81-b-${sufixo}@exemplo.test`, tenantId: '', unidadeId: '', cookie: '' },
  };

  const PERMISSOES = ['team.read', 'team.update'];

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

  /** Cria um `Student` com `profile = TRAINER` direto no banco -- nao ha `POST /team` nesta fatia. */
  let proximaMatricula = 1;
  const criarProfessorDeFixture = async (
    conta: (typeof contas)['a'],
    dados: Record<string, unknown> = {},
  ): Promise<{ id: string }> => {
    const numero = proximaMatricula;
    proximaMatricula += 1;

    return db.student.create({
      data: {
        tenantId: conta.tenantId,
        membershipNumber: `AP-TEAM-${String(numero).padStart(8, '0')}`,
        fullName: `Professor De Teste ${numero}`,
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        gymUnitId: conta.unidadeId,
        profile: 'TRAINER',
        ...dados,
      },
      select: { id: true },
    });
  };

  const criarAlunoDeFixture = async (conta: (typeof contas)['a']): Promise<{ id: string }> => {
    const numero = proximaMatricula;
    proximaMatricula += 1;

    return db.student.create({
      data: {
        tenantId: conta.tenantId,
        membershipNumber: `AP-STUD-${String(numero).padStart(8, '0')}`,
        fullName: `Aluno De Teste ${numero}`,
        birthDate: new Date('2000-01-01T00:00:00.000Z'),
        gymUnitId: conta.unidadeId,
        profile: 'STUDENT',
      },
      select: { id: true },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    await montarAcademia(contas.a, `f81-rede-a-${sufixo}`);
    await montarAcademia(contas.b, `f81-rede-b-${sufixo}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/team devolve so profile != STUDENT com X-Total-Count', async () => {
    const professor = await criarProfessorDeFixture(contas.a);
    const aluno = await criarAlunoDeFixture(contas.a);

    const resposta = await request(servidor())
      .get('/api/v1/team')
      .set('Cookie', contas.a.cookie);

    expect(resposta.status).toBe(200);
    expect(resposta.headers['x-total-count']).toBeDefined();

    const corpo = resposta.body as { id: string; profile: string }[];

    expect(corpo.every((m) => m.profile !== 'STUDENT')).toBe(true);
    expect(corpo.map((m) => m.id)).toContain(professor.id);
    expect(corpo.map((m) => m.id)).not.toContain(aluno.id);
  });

  it('PATCH /api/v1/team/:id/employment grava vinculo e responde 200', async () => {
    const professor = await criarProfessorDeFixture(contas.a);

    const resposta = await request(servidor())
      .patch(`/api/v1/team/${professor.id}/employment`)
      .set('Cookie', contas.a.cookie)
      .send({ employmentType: 'CLT', employmentStartedAt: '2024-01-01', version: 0 });

    expect(resposta.status).toBe(200);
    expect((resposta.body as { employmentType: string }).employmentType).toBe('CLT');
    expect((resposta.body as { employmentStartedAt: string }).employmentStartedAt).toBe(
      '2024-01-01',
    );
    expect((resposta.body as { version: number }).version).toBe(1);
  });

  it('PATCH /api/v1/team/:id/employment com version desatualizada responde 409', async () => {
    const professor = await criarProfessorDeFixture(contas.a);

    const resposta = await request(servidor())
      .patch(`/api/v1/team/${professor.id}/employment`)
      .set('Cookie', contas.a.cookie)
      .send({ employmentType: 'PJ', version: 99 });

    expect(resposta.status).toBe(409);
    expect((resposta.body as { code: string }).code).toBe('STALE_VERSION');
  });

  it('GET /api/v1/team/:id/agenda devolve array (vazio ou nao)', async () => {
    const professor = await criarProfessorDeFixture(contas.a);

    const resposta = await request(servidor())
      .get(`/api/v1/team/${professor.id}/agenda`)
      .set('Cookie', contas.a.cookie);

    expect(resposta.status).toBe(200);
    expect(Array.isArray(resposta.body)).toBe(true);
  });

  it('GET /api/v1/team/:id de outro tenant responde 404', async () => {
    const professor = await criarProfessorDeFixture(contas.a);

    const resposta = await request(servidor())
      .get(`/api/v1/team/${professor.id}`)
      .set('Cookie', contas.b.cookie);

    expect(resposta.status).toBe(404);
    expect((resposta.body as { code: string }).code).toBe('TEAM_MEMBER_NOT_FOUND');
  });

  it('GET /api/v1/team pagina pelo cursor -- a segunda pagina nao repete a primeira', async () => {
    const criados = [];

    for (let i = 0; i < 3; i += 1) {
      criados.push(await criarProfessorDeFixture(contas.a));
    }

    const primeira = await request(servidor())
      .get('/api/v1/team?limit=2')
      .set('Cookie', contas.a.cookie);

    expect(primeira.status).toBe(200);
    const idsDaPrimeira = (primeira.body as { id: string }[]).map((m) => m.id);
    expect(idsDaPrimeira).toHaveLength(2);

    const ultimoDaPrimeira = idsDaPrimeira[idsDaPrimeira.length - 1];

    const segunda = await request(servidor())
      .get(`/api/v1/team?limit=2&cursor=${ultimoDaPrimeira}`)
      .set('Cookie', contas.a.cookie);

    expect(segunda.status).toBe(200);
    const idsDaSegunda = (segunda.body as { id: string }[]).map((m) => m.id);

    // A segunda pagina nao pode conter nenhum id da primeira -- se o
    // controller descartasse o `cursor` (o defeito que este teste existe
    // para pegar), a segunda chamada devolveria os MESMOS dois primeiros.
    expect(idsDaSegunda.some((id) => idsDaPrimeira.includes(id))).toBe(false);
    expect(idsDaSegunda.length).toBeGreaterThan(0);
  });

  it('PATCH /api/v1/team/:id/employment em id inexistente responde 404', async () => {
    const resposta = await request(servidor())
      .patch(`/api/v1/team/${randomUUID()}/employment`)
      .set('Cookie', contas.a.cookie)
      .send({ employmentType: 'CLT', version: 0 });

    expect(resposta.status).toBe(404);
    expect((resposta.body as { code: string }).code).toBe('TEAM_MEMBER_NOT_FOUND');
  });

  it('PATCH /api/v1/team/:id/profile promove aluno para professor e responde 200', async () => {
    const aluno = await criarAlunoDeFixture(contas.a);

    const resposta = await request(servidor())
      .patch(`/api/v1/team/${aluno.id}/profile`)
      .set('Cookie', contas.a.cookie)
      .send({ profile: 'TRAINER', version: 0 });

    expect(resposta.status).toBe(200);
    expect((resposta.body as { profile: string }).profile).toBe('TRAINER');
  });

  it('PATCH /api/v1/team/:id/profile com version desatualizada responde 409', async () => {
    const professor = await criarProfessorDeFixture(contas.a);

    const resposta = await request(servidor())
      .patch(`/api/v1/team/${professor.id}/profile`)
      .set('Cookie', contas.a.cookie)
      .send({ profile: 'STUDENT', version: 99 });

    expect(resposta.status).toBe(409);
    expect((resposta.body as { code: string }).code).toBe('STALE_VERSION');
  });
});
