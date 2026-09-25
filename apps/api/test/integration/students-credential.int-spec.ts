import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * ISSUE #396 -- numero que o leitor (cartao de catraca ou identificador
 * facial) reconhece para o aluno, provado pela porta da frente.
 *
 * O que este arquivo existe para provar, e que teste unitario nao alcanca:
 *
 *   - isolamento entre tenants (INV-006): numero de um tenant nao colide
 *     com o mesmo numero em outro;
 *   - o UNIQUE do banco (`tenantId, kind, externalId`) vira erro de
 *     negocio claro, nao 500;
 *   - reenviar o MESMO numero para o MESMO aluno e no-op, nao conflito.
 */
describe('issue #396 -- credencial de acesso do aluno', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: { email: `cred-a-${sufixo}@exemplo.test`, tenantId: '', unidadeId: '', cookie: '' },
    b: { email: `cred-b-${sufixo}@exemplo.test`, tenantId: '', unidadeId: '', cookie: '' },
  };

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

  const criarAluno = async (conta: (typeof contas)['a']): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName: 'Aluno De Teste',
        birthDate: '2000-05-10',
        gymUnitId: conta.unidadeId,
        cpf: gerarCpfValido(),
        contacts: [],
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    await montarAcademia(contas.a, `cred-rede-a-${sufixo}`);
    await montarAcademia(contas.b, `cred-rede-b-${sufixo}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('vincula o numero e a ficha passa a listar a credencial', async () => {
    const alunoId = await criarAluno(contas.a);

    const resposta = await request(servidor())
      .put(`/api/v1/students/${alunoId}/credentials`)
      .set('Cookie', contas.a.cookie)
      .send({ kind: 'FACIAL_ENROLL_ID', externalId: '2219' });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ kind: 'FACIAL_ENROLL_ID', externalId: '2219' });

    const listagem = await request(servidor())
      .get(`/api/v1/students/${alunoId}/credentials`)
      .set('Cookie', contas.a.cookie);

    expect(listagem.status).toBe(200);
    expect(listagem.body).toEqual([{ kind: 'FACIAL_ENROLL_ID', externalId: '2219' }]);
  });

  it('reenviar o MESMO numero para o MESMO aluno e no-op, nao conflito', async () => {
    const alunoId = await criarAluno(contas.a);

    await request(servidor())
      .put(`/api/v1/students/${alunoId}/credentials`)
      .set('Cookie', contas.a.cookie)
      .send({ kind: 'TURNSTILE_CARD', externalId: '4471' })
      .expect(200);

    const resposta = await request(servidor())
      .put(`/api/v1/students/${alunoId}/credentials`)
      .set('Cookie', contas.a.cookie)
      .send({ kind: 'TURNSTILE_CARD', externalId: '4471' });

    expect(resposta.status).toBe(200);
  });

  it('recusa o numero que ja pertence a OUTRO aluno do mesmo tenant', async () => {
    const primeiro = await criarAluno(contas.a);
    const segundo = await criarAluno(contas.a);

    await request(servidor())
      .put(`/api/v1/students/${primeiro}/credentials`)
      .set('Cookie', contas.a.cookie)
      .send({ kind: 'FACIAL_ENROLL_ID', externalId: '9001' })
      .expect(200);

    const resposta = await request(servidor())
      .put(`/api/v1/students/${segundo}/credentials`)
      .set('Cookie', contas.a.cookie)
      .send({ kind: 'FACIAL_ENROLL_ID', externalId: '9001' });

    expect(resposta.status).toBe(400);
    expect((resposta.body as { code: string }).code).toBe('CREDENTIAL_ALREADY_ASSIGNED');

    // O primeiro aluno continua com o numero -- a recusa nao rouba nem
    // apaga a credencial de quem ja a tinha.
    const listagem = await request(servidor())
      .get(`/api/v1/students/${primeiro}/credentials`)
      .set('Cookie', contas.a.cookie);

    expect(listagem.body).toEqual([{ kind: 'FACIAL_ENROLL_ID', externalId: '9001' }]);
  });

  /*
   * ISOLAMENTO ENTRE TENANTS (INV-006): o UNIQUE e `(tenantId, kind,
   * externalId)` -- dois tenants podem usar o MESMO numero de leitor sem
   * colidir, porque sao equipamentos fisicamente diferentes.
   */
  it('o mesmo numero em tenants diferentes nao colide', async () => {
    const alunoA = await criarAluno(contas.a);
    const alunoB = await criarAluno(contas.b);

    await request(servidor())
      .put(`/api/v1/students/${alunoA}/credentials`)
      .set('Cookie', contas.a.cookie)
      .send({ kind: 'FACIAL_ENROLL_ID', externalId: '5555' })
      .expect(200);

    const resposta = await request(servidor())
      .put(`/api/v1/students/${alunoB}/credentials`)
      .set('Cookie', contas.b.cookie)
      .send({ kind: 'FACIAL_ENROLL_ID', externalId: '5555' });

    expect(resposta.status).toBe(200);
  });

  it('nao acessa credencial de aluno de OUTRO tenant', async () => {
    const alunoDoTenantA = await criarAluno(contas.a);

    const resposta = await request(servidor())
      .put(`/api/v1/students/${alunoDoTenantA}/credentials`)
      .set('Cookie', contas.b.cookie)
      .send({ kind: 'FACIAL_ENROLL_ID', externalId: '7777' });

    expect(resposta.status).toBe(404);
  });

  it('recusa numero vazio', async () => {
    const alunoId = await criarAluno(contas.a);

    const resposta = await request(servidor())
      .put(`/api/v1/students/${alunoId}/credentials`)
      .set('Cookie', contas.a.cookie)
      .send({ kind: 'FACIAL_ENROLL_ID', externalId: '' });

    expect(resposta.status).toBe(400);
  });
});
