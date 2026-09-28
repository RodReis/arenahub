import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F82 -- espelho de `PATCH /team/:id/profile` em `/students/:id/profile`.
 *
 * Mesma escrita (repositorio de `team`), rota diferente: a ficha do ALUNO
 * tambem precisa promover para professor/staff/admin, e nao so a ficha do
 * time rebaixar de volta para aluno.
 */
describe('StudentsController PATCH /:id/profile (F82)', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';
  const conta = { email: `f82-a-${sufixo}@exemplo.test`, tenantId: '', unidadeId: '', cookie: '' };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];
    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  /** Mesmo gerador de `students-cadastro-completo.int-spec.ts`: CPF valido, deterministico. */
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

  let proximaMatricula = 1;
  const criarAlunoDeFixture = async (dados: Record<string, unknown> = {}): Promise<{ id: string }> => {
    const numero = proximaMatricula;
    proximaMatricula += 1;

    return db.student.create({
      data: {
        tenantId: conta.tenantId,
        membershipNumber: `AP-F82-${String(numero).padStart(8, '0')}`,
        fullName: `Aluno F82 ${numero}`,
        birthDate: new Date('2000-01-01T00:00:00.000Z'),
        gymUnitId: conta.unidadeId,
        profile: 'STUDENT',
        ...dados,
      },
      select: { id: true },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    const senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: { slug: `f82-rede-${sufixo}`, legalName: `F82 ${sufixo} LTDA`, displayName: `F82 ${sufixo}` },
    });

    const user = await db.user.create({
      data: { email: conta.email, passwordHash: await senhas.gerarHash(SENHA) },
    });

    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id } });

    const papel = await db.role.create({ data: { tenantId: tenant.id, name: 'OWNER', isSystem: true } });

    const permissoes = await Promise.all(
      ['student.read', 'student.update', 'student.create'].map((code) =>
        db.permission.upsert({ where: { code }, create: { code }, update: {} }),
      ),
    );

    await db.rolePermission.createMany({
      data: permissoes.map((p) => ({ roleId: papel.id, permissionId: p.id })),
    });

    await db.userRole.create({ data: { tenantId: tenant.id, userId: user.id, roleId: papel.id } });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'CENTRO',
        name: `Centro F82 ${sufixo}`,
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
  });

  afterAll(async () => {
    await app?.close();
  });

  it('PATCH /api/v1/students/:id/profile promove aluno para professor e responde 200', async () => {
    const aluno = await criarAlunoDeFixture();

    const resposta = await request(servidor())
      .patch(`/api/v1/students/${aluno.id}/profile`)
      .set('Cookie', conta.cookie)
      .send({ profile: 'TRAINER', version: 0 });

    expect(resposta.status).toBe(200);
    expect((resposta.body as { profile: string }).profile).toBe('TRAINER');
  });

  it('PATCH /api/v1/students/:id/profile com version desatualizada responde 409', async () => {
    const aluno = await criarAlunoDeFixture();

    const resposta = await request(servidor())
      .patch(`/api/v1/students/${aluno.id}/profile`)
      .set('Cookie', conta.cookie)
      .send({ profile: 'STAFF', version: 99 });

    expect(resposta.status).toBe(409);
    expect((resposta.body as { code: string }).code).toBe('STUDENT_VERSION_CONFLICT');
  });

  it('PATCH /api/v1/students/:id/profile em id inexistente responde 404', async () => {
    const resposta = await request(servidor())
      .patch(`/api/v1/students/${randomUUID()}/profile`)
      .set('Cookie', conta.cookie)
      .send({ profile: 'TRAINER', version: 0 });

    expect(resposta.status).toBe(404);
    expect((resposta.body as { code: string }).code).toBe('STUDENT_NOT_FOUND');
  });

  it('POST /api/v1/students com profile no corpo cria ja como professor, sem precisar de PATCH depois', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName: 'Professor Ja Criado',
        birthDate: '1990-05-10',
        gymUnitId: conta.unidadeId,
        cpf: gerarCpfValido(),
        contacts: [],
        profile: 'TRAINER',
      });

    expect(resposta.status).toBe(201);
    expect((resposta.body as { profile?: string }).profile).toBe('TRAINER');

    const ficha = await request(servidor())
      .get(`/api/v1/students/${(resposta.body as { id: string }).id}`)
      .set('Cookie', conta.cookie);
    expect((ficha.body as { profile?: string }).profile).toBe('TRAINER');
  });

  it('POST /api/v1/students sem profile continua criando aluno comum (STUDENT)', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName: 'Aluno Sem Profile No Corpo',
        birthDate: '1990-05-10',
        gymUnitId: conta.unidadeId,
        cpf: gerarCpfValido(),
        contacts: [],
      });

    expect(resposta.status).toBe(201);
    expect((resposta.body as { profile?: string }).profile).toBe('STUDENT');
  });
});
