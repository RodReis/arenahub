import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F18 -- historico e comparativos, pela porta da frente.
 *
 * O que este arquivo prova, e que teste de funcao pura nao alcanca:
 *
 *   - a serie ignora RASCUNHO -- so numero oficial vira ponto;
 *   - correcao SUBSTITUI a original na serie, e a original continua
 *     publicada no banco (INV-102);
 *   - campo ausente nao vira ponto nem zero (INV-104, `M3-AC-004`);
 *   - a meta entra no comparativo e a segunda meta ativa do mesmo tipo e
 *     recusada PELO BANCO (indice parcial);
 *   - meta em outra unidade de medida e convertida antes de comparar
 *     (INV-105);
 *   - periodo invalido responde 400 em vez de cair num padrao;
 *   - isolamento entre tenants nas rotas novas (INV-006).
 */
describe('F18 -- historico e comparativos', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: { email: `f18-a-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
    b: { email: `f18-b-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
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

  const criarAluno = async (conta: (typeof contas)['a']): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName: 'Aluno De Teste',
        birthDate: '1990-05-10',
        gymUnitId: conta.gymUnitId,
        contacts: [],
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  interface MedidaEnviada {
    type: string;
    value: number;
    unit: string | null;
  }

  const criarRascunho = async (
    conta: (typeof contas)['a'],
    studentId: string,
    assessedAt: string,
    medidas: MedidaEnviada[],
  ): Promise<request.Response> =>
    request(servidor())
      .post(`/api/v1/students/${studentId}/assessments`)
      .set('Cookie', conta.cookie)
      .send({ assessedAt, measurements: medidas });

  /** Cria e publica numa tacada. */
  const publicada = async (
    conta: (typeof contas)['a'],
    studentId: string,
    assessedAt: string,
    medidas: MedidaEnviada[],
  ): Promise<string> => {
    const rascunho = await criarRascunho(conta, studentId, assessedAt, medidas);
    expect(rascunho.status).toBe(201);

    const id = (rascunho.body as { id: string }).id;

    const resposta = await request(servidor())
      .post(`/api/v1/assessments/${id}/publish`)
      .set('Cookie', conta.cookie)
      .send({});

    expect(resposta.status).toBe(201);

    return id;
  };

  interface VariacaoResposta {
    absolute: number | null;
    percent: number | null;
    fromAssessmentId: string | null;
    toAssessmentId: string | null;
    absentReason: string | null;
  }

  interface ComparativoResposta {
    type: string;
    unit: string | null;
    points: { assessmentId: string; assessedAt: string; value: number }[];
    first: { assessmentId: string; value: number } | null;
    previous: { assessmentId: string; value: number } | null;
    current: { assessmentId: string; value: number } | null;
    sinceFirst: VariacaoResposta;
    sincePrevious: VariacaoResposta;
    toGoal: VariacaoResposta;
    goal: { id: string; target: number; deadline: string } | null;
  }

  interface HistoricoResposta {
    studentId: string;
    period: string;
    timezone: string;
    measurements: ComparativoResposta[];
  }

  const historico = async (
    conta: (typeof contas)['a'],
    studentId: string,
    periodo = 'ALL',
  ): Promise<request.Response> =>
    request(servidor())
      .get(`/api/v1/students/${studentId}/health-progress?period=${periodo}`)
      .set('Cookie', conta.cookie);

  const doTipo = (corpo: HistoricoResposta, tipo: string): ComparativoResposta => {
    const achado = corpo.measurements.find((m) => m.type === tipo);

    expect(achado).toBeDefined();

    return achado as ComparativoResposta;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);

    await montarAcademia(contas.a, `f18-academia-a-${sufixo}`);
    await montarAcademia(contas.b, `f18-academia-b-${sufixo}`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('monta a serie em ordem crescente, com primeira, anterior e atual', async () => {
    const aluno = await criarAluno(contas.a);

    await publicada(contas.a, aluno, '2026-01-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 90, unit: 'kg' },
    ]);
    const meio = await publicada(contas.a, aluno, '2026-03-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 85, unit: 'kg' },
    ]);
    const ultima = await publicada(contas.a, aluno, '2026-06-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 81, unit: 'kg' },
    ]);

    const resposta = await historico(contas.a, aluno);

    expect(resposta.status).toBe(200);

    const peso = doTipo(resposta.body as HistoricoResposta, 'WEIGHT');

    expect(peso.points.map((p) => p.value)).toEqual([90, 85, 81]);
    expect(peso.previous?.assessmentId).toBe(meio);
    expect(peso.current?.assessmentId).toBe(ultima);
    expect(peso.sinceFirst.absolute).toBe(-9);
    expect(peso.sinceFirst.percent).toBeCloseTo(-10, 6);
    // Proveniencia: o numero aponta as avaliacoes que o sustentam.
    expect(peso.sinceFirst.toAssessmentId).toBe(ultima);
  });

  it('rascunho nao entra na serie -- so numero oficial vira ponto', async () => {
    const aluno = await criarAluno(contas.a);

    await publicada(contas.a, aluno, '2026-01-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 90, unit: 'kg' },
    ]);

    // Rascunho com valor absurdo: se vazar para a serie, o teste quebra alto.
    const rascunho = await criarRascunho(contas.a, aluno, '2026-05-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 499, unit: 'kg' },
    ]);
    expect(rascunho.status).toBe(201);

    const peso = doTipo((await historico(contas.a, aluno)).body as HistoricoResposta, 'WEIGHT');

    expect(peso.points.map((p) => p.value)).toEqual([90]);
  });

  it('correcao substitui a original na serie, e a original continua publicada (INV-102)', async () => {
    const aluno = await criarAluno(contas.a);

    await publicada(contas.a, aluno, '2026-01-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 90, unit: 'kg' },
    ]);
    const errada = await publicada(contas.a, aluno, '2026-06-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 499, unit: 'kg' },
    ]);

    const correcao = await request(servidor())
      .post(`/api/v1/assessments/${errada}/corrections`)
      .set('Cookie', contas.a.cookie)
      .send({
        assessedAt: '2026-06-10T12:00:00.000Z',
        measurements: [{ type: 'WEIGHT', value: 81, unit: 'kg' }],
      });

    expect(correcao.status).toBe(201);

    const peso = doTipo((await historico(contas.a, aluno)).body as HistoricoResposta, 'WEIGHT');

    // Dois pontos, nao tres: o 499 saiu da serie.
    expect(peso.points.map((p) => p.value)).toEqual([90, 81]);
    expect(peso.current?.value).toBe(81);

    // Mas a original NAO foi apagada -- ela prova que o numero errado circulou.
    const original = await db.bodyAssessment.findFirst({ where: { id: errada } });

    expect(original?.status).toBe('PUBLISHED');
  });

  it('campo ausente nao vira ponto nem zero (INV-104, M3-AC-004)', async () => {
    const aluno = await criarAluno(contas.a);

    await publicada(contas.a, aluno, '2026-01-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 90, unit: 'kg' },
      { type: 'BODY_FAT_PERCENT', value: 28, unit: 'percent' },
    ]);
    // Avaliacao SO de circunferencia: nao pesou, nao mediu gordura.
    await publicada(contas.a, aluno, '2026-03-10T12:00:00.000Z', [
      { type: 'WAIST_CIRCUMFERENCE', value: 92, unit: 'cm' },
    ]);
    await publicada(contas.a, aluno, '2026-06-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 84, unit: 'kg' },
    ]);

    const corpo = (await historico(contas.a, aluno)).body as HistoricoResposta;
    const peso = doTipo(corpo, 'WEIGHT');
    const gordura = doTipo(corpo, 'BODY_FAT_PERCENT');

    // O dia sem balanca NAO virou ponto zero -- ele simplesmente nao existe
    // na serie de peso.
    expect(peso.points.map((p) => p.value)).toEqual([90, 84]);
    expect(peso.points.some((p) => p.value === 0)).toBe(false);

    // Gordura foi medida uma vez so: sem anterior, sem variacao -- e a razao
    // e explicita, nao um zero que leria como "nao mudou".
    expect(gordura.points).toHaveLength(1);
    expect(gordura.sincePrevious.absolute).toBeNull();
    expect(gordura.sincePrevious.absentReason).toBe('SEM_BASELINE');
  });

  it('meta entra no comparativo e mede a distancia ate o alvo', async () => {
    const aluno = await criarAluno(contas.a);

    await publicada(contas.a, aluno, '2026-06-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 80, unit: 'kg' },
    ]);

    const meta = await request(servidor())
      .post(`/api/v1/students/${aluno}/health-goals`)
      .set('Cookie', contas.a.cookie)
      .send({
        type: 'WEIGHT',
        baselineValue: 80,
        targetValue: 75,
        unit: 'kg',
        deadline: '2026-12-31',
      });

    expect(meta.status).toBe(201);

    const peso = doTipo((await historico(contas.a, aluno)).body as HistoricoResposta, 'WEIGHT');

    expect(peso.goal?.target).toBe(75);
    // Faltam 5 kg para baixo.
    expect(peso.toGoal.absolute).toBe(-5);
  });

  it('meta em libras e convertida antes de comparar com serie em quilos (INV-105)', async () => {
    const aluno = await criarAluno(contas.a);

    await publicada(contas.a, aluno, '2026-06-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 100, unit: 'kg' },
    ]);

    // 220.462 lb = 100 kg. Sem conversao, o alvo "220" leria como 220 kg e o
    // comparativo mostraria o aluno 120 kg abaixo da meta.
    const meta = await request(servidor())
      .post(`/api/v1/students/${aluno}/health-goals`)
      .set('Cookie', contas.a.cookie)
      .send({
        type: 'WEIGHT',
        baselineValue: 220.462,
        targetValue: 198.416,
        unit: 'lb',
        deadline: '2026-12-31',
      });

    expect(meta.status).toBe(201);
    expect((meta.body as { unit: string | null }).unit).toBe('KG');
    // 198.416 lb = 90.0 kg.
    expect((meta.body as { targetValue: number }).targetValue).toBeCloseTo(90, 3);

    const peso = doTipo((await historico(contas.a, aluno)).body as HistoricoResposta, 'WEIGHT');

    expect(peso.toGoal.absolute).toBeCloseTo(-10, 3);
  });

  it('segunda meta ativa do mesmo tipo e recusada com 409', async () => {
    const aluno = await criarAluno(contas.a);

    const primeira = await request(servidor())
      .post(`/api/v1/students/${aluno}/health-goals`)
      .set('Cookie', contas.a.cookie)
      .send({ type: 'WEIGHT', baselineValue: 90, targetValue: 80, unit: 'kg', deadline: '2026-12-31' });

    expect(primeira.status).toBe(201);

    const segunda = await request(servidor())
      .post(`/api/v1/students/${aluno}/health-goals`)
      .set('Cookie', contas.a.cookie)
      .send({ type: 'WEIGHT', baselineValue: 88, targetValue: 78, unit: 'kg', deadline: '2026-12-31' });

    expect(segunda.status).toBe(409);
    expect((segunda.body as { code: string }).code).toBe('HEALTH_GOAL_ALREADY_ACTIVE');
  });

  it('depois de encerrar, o aluno pode ter meta nova do mesmo tipo', async () => {
    const aluno = await criarAluno(contas.a);

    const primeira = await request(servidor())
      .post(`/api/v1/students/${aluno}/health-goals`)
      .set('Cookie', contas.a.cookie)
      .send({ type: 'WEIGHT', baselineValue: 90, targetValue: 80, unit: 'kg', deadline: '2026-06-30' });

    expect(primeira.status).toBe(201);

    const encerrar = await request(servidor())
      .post(`/api/v1/health-goals/${(primeira.body as { id: string }).id}/close`)
      .set('Cookie', contas.a.cookie)
      .send({});

    expect(encerrar.status).toBe(201);

    const nova = await request(servidor())
      .post(`/api/v1/students/${aluno}/health-goals`)
      .set('Cookie', contas.a.cookie)
      .send({ type: 'WEIGHT', baselineValue: 80, targetValue: 76, unit: 'kg', deadline: '2026-12-31' });

    expect(nova.status).toBe(201);
  });

  it('periodo corta a serie pelo instante da medicao', async () => {
    const aluno = await criarAluno(contas.a);

    // Uma avaliacao MUITO antiga e uma recente. `30D` tem de deixar so a
    // recente de fora do alcance do corte.
    await publicada(contas.a, aluno, '2020-01-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 120, unit: 'kg' },
    ]);
    await publicada(contas.a, aluno, new Date().toISOString(), [
      { type: 'WEIGHT', value: 80, unit: 'kg' },
    ]);

    const tudo = doTipo((await historico(contas.a, aluno, 'ALL')).body as HistoricoResposta, 'WEIGHT');
    const recente = doTipo(
      (await historico(contas.a, aluno, '30D')).body as HistoricoResposta,
      'WEIGHT',
    );

    expect(tudo.points).toHaveLength(2);
    expect(recente.points.map((p) => p.value)).toEqual([80]);
  });

  it('periodo invalido responde 400 em vez de cair num padrao', async () => {
    const aluno = await criarAluno(contas.a);

    const resposta = await historico(contas.a, aluno, '60D');

    expect(resposta.status).toBe(400);
    expect((resposta.body as { code: string }).code).toBe('HEALTH_INVALID_PERIOD');
  });

  it('a resposta carrega o fuso da unidade do aluno', async () => {
    const aluno = await criarAluno(contas.a);

    const corpo = (await historico(contas.a, aluno)).body as HistoricoResposta;

    expect(corpo.timezone).toBe('America/Sao_Paulo');
  });

  it('academia B nao le historico de aluno da academia A (INV-006)', async () => {
    const aluno = await criarAluno(contas.a);

    await publicada(contas.a, aluno, '2026-06-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 80, unit: 'kg' },
    ]);

    const resposta = await historico(contas.b, aluno);

    expect(resposta.status).toBe(404);
  });

  it('academia B nao cria meta para aluno da academia A (INV-006)', async () => {
    const aluno = await criarAluno(contas.a);

    const resposta = await request(servidor())
      .post(`/api/v1/students/${aluno}/health-goals`)
      .set('Cookie', contas.b.cookie)
      .send({ type: 'WEIGHT', baselineValue: 90, targetValue: 80, unit: 'kg', deadline: '2026-12-31' });

    expect(resposta.status).toBeGreaterThanOrEqual(400);

    const metas = await db.healthGoal.findMany({ where: { studentId: aluno } });

    expect(metas).toHaveLength(0);
  });
});
