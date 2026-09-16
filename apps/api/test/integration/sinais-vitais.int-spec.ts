import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

const diretorioAtual = dirname(fileURLToPath(import.meta.url));

function lerFixturePdfDeEcg(): Buffer {
  const caminho = join(diretorioAtual, '..', 'fixtures', 'health', 'ecg-omron-sintetico.pdf');

  return readFileSync(caminho);
}

/**
 * Card #345 -- sinal vital avulso do aluno (pressao, saturacao, FC de
 * repouso), pela porta da frente.
 *
 * O que este arquivo prova:
 *
 *   - registro manual de BLOOD_PRESSURE exige a diastolica, e a rejeita fora
 *     de faixa plausivel;
 *   - OXYGEN_SATURATION e RESTING_HEART_RATE manuais nao aceitam segundo
 *     numero;
 *   - upload do PDF de ECG real publica RESTING_HEART_RATE com `source:
 *     IMPORT` e o achado do aparelho em `deviceReport`, sem interpretar
 *     (ADR-035, regra de arquitetura no 8);
 *   - listagem devolve os registros do aluno, mais recente primeiro;
 *   - isolamento entre tenants (INV-006): a academia B nao ve nem grava
 *     sinal vital do aluno da academia A.
 */
describe('F345 -- sinal vital avulso do aluno', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: { email: `f345-a-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
    b: { email: `f345-b-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
  };

  const PERMISSOES = ['student.create', 'student.read', 'health.read', 'health.assess'];

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  const montarAcademia = async (
    conta: { email: string; tenantId: string; gymUnitId: string; cookie: string },
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
    conta.gymUnitId = unidade.id;
    conta.cookie = cookieDeAcesso(login);
  };

  /**
   * CPF valido, DIFERENTE a cada chamada -- mesmo algoritmo do teste da F45
   * (`students-cadastro-completo.int-spec.ts`). Contador simples, nao
   * aleatorio: teste tem de ser deterministico.
   */
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
        birthDate: '1990-05-10',
        gymUnitId: conta.gymUnitId,
        cpf: gerarCpfValido(),
        contacts: [],
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = modulo.createNestApplication();
    await app.init();

    db = app.get(PrismaService);

    await montarAcademia(contas.a, `f345-a-${sufixo}`);
    await montarAcademia(contas.b, `f345-b-${sufixo}`);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('registro manual', () => {
    it('registra pressao arterial com sistolica e diastolica', async () => {
      const alunoId = await criarAluno(contas.a);

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/vitals`)
        .set('Cookie', contas.a.cookie)
        .send({
          type: 'BLOOD_PRESSURE',
          value: 120,
          secondaryValue: 80,
          measuredAt: new Date().toISOString(),
        });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({
        type: 'BLOOD_PRESSURE',
        value: 120,
        secondaryValue: 80,
        unit: 'mmHg',
        source: 'MANUAL',
      });
    });

    it('recusa pressao sem diastolica', async () => {
      const alunoId = await criarAluno(contas.a);

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/vitals`)
        .set('Cookie', contas.a.cookie)
        .send({ type: 'BLOOD_PRESSURE', value: 120, measuredAt: new Date().toISOString() });

      expect(resposta.status).toBe(422);
    });

    it('registra saturacao sem segundo numero', async () => {
      const alunoId = await criarAluno(contas.a);

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/vitals`)
        .set('Cookie', contas.a.cookie)
        .send({ type: 'OXYGEN_SATURATION', value: 97, measuredAt: new Date().toISOString() });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({
        type: 'OXYGEN_SATURATION',
        value: 97,
        secondaryValue: null,
        unit: '%',
      });
    });

    it('recusa saturacao fora da faixa plausivel', async () => {
      const alunoId = await criarAluno(contas.a);

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/vitals`)
        .set('Cookie', contas.a.cookie)
        .send({ type: 'OXYGEN_SATURATION', value: 150, measuredAt: new Date().toISOString() });

      expect(resposta.status).toBe(422);
    });

    it('registra FC de repouso manual', async () => {
      const alunoId = await criarAluno(contas.a);

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/vitals`)
        .set('Cookie', contas.a.cookie)
        .send({ type: 'RESTING_HEART_RATE', value: 62, measuredAt: new Date().toISOString() });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ type: 'RESTING_HEART_RATE', value: 62, unit: 'bpm' });
    });

    it('recusa aluno de outro tenant', async () => {
      const alunoDeA = await criarAluno(contas.a);

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoDeA}/vitals`)
        .set('Cookie', contas.b.cookie)
        .send({ type: 'RESTING_HEART_RATE', value: 62, measuredAt: new Date().toISOString() });

      expect(resposta.status).toBe(404);
    });
  });

  describe('importacao de PDF (ECG -> RESTING_HEART_RATE)', () => {
    it('extrai a FC do PDF real e guarda o achado do aparelho sem interpretar', async () => {
      const alunoId = await criarAluno(contas.a);

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/vitals/import`)
        .set('Cookie', contas.a.cookie)
        .field('measuredAt', new Date().toISOString())
        .attach('file', lerFixturePdfDeEcg(), 'ecg.pdf');

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({
        type: 'RESTING_HEART_RATE',
        unit: 'bpm',
        source: 'IMPORT',
        deviceModel: 'ALIVECOR_ECG',
      });
      expect((resposta.body as { value: number }).value).toBeGreaterThan(0);
    });
  });

  describe('listagem', () => {
    it('lista os sinais vitais do aluno, mais recente primeiro', async () => {
      const alunoId = await criarAluno(contas.a);

      await request(servidor())
        .post(`/api/v1/students/${alunoId}/vitals`)
        .set('Cookie', contas.a.cookie)
        .send({
          type: 'RESTING_HEART_RATE',
          value: 60,
          measuredAt: new Date(Date.now() - 60_000).toISOString(),
        });

      await request(servidor())
        .post(`/api/v1/students/${alunoId}/vitals`)
        .set('Cookie', contas.a.cookie)
        .send({ type: 'RESTING_HEART_RATE', value: 65, measuredAt: new Date().toISOString() });

      const resposta = await request(servidor())
        .get(`/api/v1/students/${alunoId}/vitals`)
        .set('Cookie', contas.a.cookie);

      expect(resposta.status).toBe(200);

      const lista = resposta.body as { value: number }[];

      expect(lista).toHaveLength(2);
      expect(lista[0]?.value).toBe(65);
      expect(lista[1]?.value).toBe(60);
    });

    it('isolamento entre tenants: a academia B nao ve sinal vital da academia A', async () => {
      const alunoDeA = await criarAluno(contas.a);

      await request(servidor())
        .post(`/api/v1/students/${alunoDeA}/vitals`)
        .set('Cookie', contas.a.cookie)
        .send({ type: 'RESTING_HEART_RATE', value: 60, measuredAt: new Date().toISOString() });

      const resposta = await request(servidor())
        .get(`/api/v1/students/${alunoDeA}/vitals`)
        .set('Cookie', contas.b.cookie);

      expect(resposta.status).toBe(404);
    });
  });
});
