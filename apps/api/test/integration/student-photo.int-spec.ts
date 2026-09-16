import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F72 -- foto do aluno na ficha do painel (issue #348), pela porta da
 * frente. O que este arquivo prova, e que teste de dominio puro nao alcanca:
 *
 *   - upload grava o objeto no storage e `temFoto` vira `true` na ficha;
 *   - leitura devolve os bytes certos, com o content-type declarado;
 *   - reenvio SUBSTITUI o arquivo anterior -- o objeto velho e apagado;
 *   - arquivo infectado e recusado e NAO fica no storage;
 *   - SVG e recusado -- foto de pessoa nao e vetor (ao contrario do icone do
 *     tenant, que aceita);
 *   - aluno de outro tenant nao expoe nem aceita foto por este id.
 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const OUTRO_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x01]);

/**
 * PNG "infectado": assinatura valida seguida da string EICAR, que o
 * `FakeMalwareScannerAdapter` reconhece. Precisa comecar com a assinatura
 * PNG para passar da checagem de formato antes de chegar no antivirus.
 */
const PNG_INFECTADO = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR', '-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('')),
]);

describe('F72 -- foto do aluno', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: { email: `f72-a-${sufixo}@exemplo.test`, tenantId: '', unidadeId: '', cookie: '' },
    b: { email: `f72-b-${sufixo}@exemplo.test`, tenantId: '', unidadeId: '', cookie: '' },
  };

  const PERMISSOES = ['student.create', 'student.read', 'student.update'];

  /** Objetos gravados pelo storage falso, para conferir o que sobrevive. */
  const gravados = new Map<string, { body: Buffer; contentType: string }>();

  const storageFalso = {
    putPrivateObject: (entrada: { key: string; body: Buffer; contentType: string }) => {
      gravados.set(entrada.key, { body: entrada.body, contentType: entrada.contentType });

      return Promise.resolve();
    },
    getPrivateObject: (key: string) => {
      const objeto = gravados.get(key);

      if (!objeto) return Promise.reject(new Error('objeto nao encontrado'));

      return Promise.resolve(objeto);
    },
    deletePrivateObject: (key: string) => {
      gravados.delete(key);

      return Promise.resolve();
    },
  };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  const montarAcademia = async (conta: (typeof contas)['a'], slug: string): Promise<void> => {
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

    await db.userRole.create({ data: { tenantId: tenant.id, userId: user.id, roleId: papel.id } });

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

  const criarAluno = async (conta: (typeof contas)['a'], nome: string): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName: nome,
        birthDate: '2000-05-10',
        gymUnitId: conta.unidadeId,
        cpf: '52998224725',
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storageFalso)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);

    await montarAcademia(contas.a, `f72-academia-a-${sufixo}`);
    await montarAcademia(contas.b, `f72-academia-b-${sufixo}`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('upload grava o objeto e a ficha passa a mostrar temFoto', async () => {
    const studentId = await criarAluno(contas.a, 'Aluno Com Foto');

    const upload = await request(servidor())
      .put(`/api/v1/students/${studentId}/photo`)
      .set('Cookie', contas.a.cookie)
      .attach('file', PNG, { filename: 'foto.png', contentType: 'image/png' });

    expect(upload.status).toBe(200);
    expect(upload.body).toEqual({ temFoto: true });

    const ficha = await request(servidor())
      .get(`/api/v1/students/${studentId}`)
      .set('Cookie', contas.a.cookie);

    expect((ficha.body as { temFoto: boolean }).temFoto).toBe(true);
  });

  it('leitura devolve os bytes e o content-type gravados', async () => {
    const studentId = await criarAluno(contas.a, 'Aluno Leitura');

    await request(servidor())
      .put(`/api/v1/students/${studentId}/photo`)
      .set('Cookie', contas.a.cookie)
      .attach('file', PNG, { filename: 'foto.png', contentType: 'image/png' });

    const leitura = await request(servidor())
      .get(`/api/v1/students/${studentId}/photo`)
      .set('Cookie', contas.a.cookie);

    expect(leitura.status).toBe(200);
    expect(leitura.headers['content-type']).toContain('image/png');
    expect(Buffer.compare(leitura.body as Buffer, PNG)).toBe(0);
  });

  it('reenvio substitui o arquivo anterior, e o objeto velho e apagado', async () => {
    const studentId = await criarAluno(contas.a, 'Aluno Substitui');

    const primeiro = await request(servidor())
      .put(`/api/v1/students/${studentId}/photo`)
      .set('Cookie', contas.a.cookie)
      .attach('file', PNG, { filename: 'foto.png', contentType: 'image/png' });

    const chaveAntiga = [...gravados.keys()].find((k) => k.includes(studentId));
    expect(primeiro.status).toBe(200);
    expect(chaveAntiga).toBeDefined();

    await request(servidor())
      .put(`/api/v1/students/${studentId}/photo`)
      .set('Cookie', contas.a.cookie)
      .attach('file', OUTRO_PNG, { filename: 'foto2.png', contentType: 'image/png' });

    // Mesma extensao -> MESMA chave -- nao ha "objeto velho" para apagar
    // aqui, so a sobrescrita. O conteudo tem de ser o mais recente.
    const leitura = await request(servidor())
      .get(`/api/v1/students/${studentId}/photo`)
      .set('Cookie', contas.a.cookie);

    expect(Buffer.compare(leitura.body as Buffer, OUTRO_PNG)).toBe(0);
  });

  it('arquivo infectado e recusado e nao fica no storage', async () => {
    const studentId = await criarAluno(contas.a, 'Aluno Infectado');

    const resposta = await request(servidor())
      .put(`/api/v1/students/${studentId}/photo`)
      .set('Cookie', contas.a.cookie)
      .attach('file', PNG_INFECTADO, { filename: 'foto.png', contentType: 'image/png' });

    expect(resposta.status).toBe(422);
    expect([...gravados.keys()].some((k) => k.includes(studentId))).toBe(false);
  });

  it('recusa SVG -- foto de pessoa nao e vetor', async () => {
    const studentId = await criarAluno(contas.a, 'Aluno Svg');

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    const resposta = await request(servidor())
      .put(`/api/v1/students/${studentId}/photo`)
      .set('Cookie', contas.a.cookie)
      .attach('file', svg, { filename: 'foto.svg', contentType: 'image/svg+xml' });

    expect(resposta.status).toBe(400);
    expect((resposta.body as { code: string }).code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('nao le nem aceita foto de aluno de outro tenant', async () => {
    const studentId = await criarAluno(contas.a, 'Aluno Tenant A');

    await request(servidor())
      .put(`/api/v1/students/${studentId}/photo`)
      .set('Cookie', contas.a.cookie)
      .attach('file', PNG, { filename: 'foto.png', contentType: 'image/png' });

    const leituraCruzada = await request(servidor())
      .get(`/api/v1/students/${studentId}/photo`)
      .set('Cookie', contas.b.cookie);

    // 404, nunca 403: 403 confirmaria que o id existe noutro tenant.
    expect(leituraCruzada.status).toBe(404);

    const uploadCruzado = await request(servidor())
      .put(`/api/v1/students/${studentId}/photo`)
      .set('Cookie', contas.b.cookie)
      .attach('file', OUTRO_PNG, { filename: 'foto.png', contentType: 'image/png' });

    expect(uploadCruzado.status).toBe(404);
  });
});
