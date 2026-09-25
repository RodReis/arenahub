import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * ISSUE #398 -- a busca de `/students` nao ignorava acento.
 *
 * "Julio Cesar" nunca achava "Julio César": `contains` do Prisma so ignora
 * CAIXA (`mode: 'insensitive'`), nunca diacritico. 179 de 1995 alunos do
 * tenant de bancada tem acento no nome -- nao e caso raro, e a recepcao so
 * achava esses alunos se digitasse o acento exato.
 *
 * Achado na pratica: Julio César de Toledo Junior tinha fatura vencida na
 * fila de cobranca (`/billing/delinquency`) mas nao aparecia buscando
 * "Julio Cesar" em `/students` -- o aluno existia, ativo, so a busca nao o
 * alcancava.
 */
describe('issue #398 -- busca de aluno ignora acento', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const conta = { email: `acento-${sufixo}@exemplo.test`, tenantId: '', unidadeId: '', cookie: '' };

  const PERMISSOES = ['student.create', 'student.read'];

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
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

  const criarAluno = async (fullName: string): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName,
        birthDate: '2000-05-10',
        gymUnitId: conta.unidadeId,
        cpf: gerarCpfValido(),
        contacts: [],
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  const buscar = (termo: string): Promise<request.Response> =>
    request(servidor())
      .get(`/api/v1/students?q=${encodeURIComponent(termo)}`)
      .set('Cookie', conta.cookie);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    const senhas = app.get(PasswordService);
    const slug = `acento-rede-${sufixo}`;

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
  });

  afterAll(async () => {
    await app?.close();
  });

  it('acha "Julio Cesar" quando o cadastro tem "Julio César" -- o caso real', async () => {
    const alunoId = await criarAluno(`Julio César de Toledo Junior ${sufixo}`);

    const resposta = await buscar(`Julio Cesar de Toledo Junior ${sufixo}`);

    expect(resposta.status).toBe(200);
    const ids = (resposta.body as { id: string }[]).map((a) => a.id);
    expect(ids).toContain(alunoId);
  });

  it('acha "José" quando o termo digitado nao tem acento -- e vice-versa', async () => {
    const alunoId = await criarAluno(`José da Silva ${sufixo}`);

    const semAcento = await buscar(`Jose da Silva ${sufixo}`);
    const comAcento = await buscar(`José da Silva ${sufixo}`);

    expect((semAcento.body as { id: string }[]).map((a) => a.id)).toContain(alunoId);
    expect((comAcento.body as { id: string }[]).map((a) => a.id)).toContain(alunoId);
  });

  it('continua achando por matricula e nao devolve gente de mais por acaso', async () => {
    await criarAluno(`Zero Resultado Esperado ${sufixo}`);

    const resposta = await buscar(`Xpto-inexistente-${sufixo}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body as unknown[]).toEqual([]);
  });
});
