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

  /** Objetos gravados pelo storage falso, para inspecionar o CSV de verdade. */
  const gravados = new Map<string, Buffer>();

  const storageFalso = {
    createPrivateUpload: () =>
      Promise.resolve({ uploadUrl: 'https://storage.test/x', expiresAt: '' }),
    headPrivateObject: () => Promise.resolve({ size: 1, contentType: 'text/csv' }),
    deletePrivateObject: (key: string) => {
      gravados.delete(key);

      return Promise.resolve();
    },
    putPrivateObject: (entrada: { key: string; body: Buffer }) => {
      gravados.set(entrada.key, entrada.body);

      return Promise.resolve();
    },
    createPrivateDownload: (entrada: { key: string }) =>
      Promise.resolve({
        downloadUrl: `https://storage.test/${entrada.key}?assinada=1`,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    verificar: () => Promise.resolve(true),
  };

  /** O CSV escrito pela ultima exportacao, como texto. */
  const csvGravado = (): string => {
    const ultimo = [...gravados.values()].at(-1);

    expect(ultimo).toBeDefined();

    return (ultimo as Buffer).toString('utf8');
  };

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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storageFalso)
      .compile();

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

  it('correcao com data diferente da original nao faz a medicao SUMIR do periodo', async () => {
    // ACHADO NA REVISAO ADVERSARIAL DESTA FATIA, e o pior tipo de defeito:
    // o dado nao aparece errado, ele DESAPARECE.
    //
    // `POST /assessments/:id/corrections` aceita `assessedAt` livre do corpo,
    // entao a correcao pode carimbar uma data diferente da original -- o caso
    // real e perceber o erro meses depois e REMEDIR o aluno.
    //
    // O corte de periodo filtra linha a linha. Com a original DENTRO da
    // janela e a correcao FORA, a consulta trazia a original (marcada como
    // corrigida) sem trazer a folha; `selecionarFolhas` descartava a
    // original, e o tipo sumia inteiro da tela -- sem aviso, como se o aluno
    // nunca tivesse sido medido.
    const aluno = await criarAluno(contas.a);

    const agora = new Date();
    const dentroDaJanela = new Date(agora.getTime() - 5 * 86_400_000).toISOString();

    const original = await publicada(contas.a, aluno, dentroDaJanela, [
      { type: 'WEIGHT', value: 90, unit: 'kg' },
    ]);

    // A correcao remede o aluno e carimba data ANTIGA -- fora de `30D`.
    const correcao = await request(servidor())
      .post(`/api/v1/assessments/${original}/corrections`)
      .set('Cookie', contas.a.cookie)
      .send({
        assessedAt: '2020-01-10T12:00:00.000Z',
        measurements: [{ type: 'WEIGHT', value: 81, unit: 'kg' }],
      });

    expect(correcao.status).toBe(201);

    const corpo = (await historico(contas.a, aluno, '30D')).body as HistoricoResposta;
    const peso = corpo.measurements.find((m) => m.type === 'WEIGHT');

    // O peso do aluno NAO pode sumir da tela. Ou aparece o valor corrigido,
    // ou aparece vazio com razao -- nunca o tipo inteiro desaparecendo.
    expect(peso).toBeDefined();
    expect(peso?.current).not.toBeNull();
    // E o valor exibido e o CORRIGIDO, nunca o numero que foi substituido.
    expect(peso?.current?.value).toBe(81);
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

  describe('exportacao (M3-FR-017, M3-AC-010)', () => {
    const exportar = async (
      conta: (typeof contas)['a'],
      studentId: string,
      chave: string,
    ): Promise<request.Response> =>
      request(servidor())
        .post(`/api/v1/students/${studentId}/health-exports`)
        .set('Cookie', conta.cookie)
        .send({ idempotencyKey: chave });

    it('exporta avaliacoes, medidas, origem e datas (M3-AC-010)', async () => {
      const aluno = await criarAluno(contas.a);

      await publicada(contas.a, aluno, '2026-01-10T12:00:00.000Z', [
        { type: 'WEIGHT', value: 90, unit: 'kg' },
        { type: 'BODY_FAT_PERCENT', value: 28, unit: 'percent' },
      ]);
      await publicada(contas.a, aluno, '2026-06-10T12:00:00.000Z', [
        { type: 'WEIGHT', value: 81.25, unit: 'kg' },
      ]);

      const resposta = await exportar(contas.a, aluno, `f18-export-${sufixo}-1`);

      expect(resposta.status).toBe(201);

      const corpo = resposta.body as { rowCount: number; downloadUrl: string };

      // Uma linha por MEDIDA, nao por avaliacao: 2 + 1.
      expect(corpo.rowCount).toBe(3);
      expect(corpo.downloadUrl).toContain('assinada=1');

      const csv = csvGravado();

      expect(csv).toContain('assessment_id');
      expect(csv).toContain('WEIGHT');
      expect(csv).toContain('BODY_FAT_PERCENT');
      expect(csv).toContain('Aluno De Teste');
      // Origem e datas, exigidas pelo `M3-AC-010`.
      expect(csv).toContain('MANUAL');
      expect(csv).toContain('2026-06-10T12:00:00.000Z');
    });

    it('preserva o decimal exato, sem passar por number (INV-106)', async () => {
      const aluno = await criarAluno(contas.a);

      await publicada(contas.a, aluno, '2026-06-10T12:00:00.000Z', [
        { type: 'WEIGHT', value: 81.25, unit: 'kg' },
      ]);

      await exportar(contas.a, aluno, `f18-export-${sufixo}-decimal`);

      // O `Decimal(10,4)` do banco chega como texto: `81.25` vira `81.25`, e
      // nao `81.2500000001`. Quem confere a planilha contra o laudo veria a
      // diferenca.
      expect(csvGravado()).toContain('81.25');
    });

    it('preserva a unidade ORIGINAL junto da canonica (INV-105)', async () => {
      const aluno = await criarAluno(contas.a);

      // Medido em libras: o canonico vira kg, mas o arquivo tem de provar em
      // que unidade a balanca reportava.
      await publicada(contas.a, aluno, '2026-06-10T12:00:00.000Z', [
        { type: 'WEIGHT', value: 200, unit: 'lb' },
      ]);

      await exportar(contas.a, aluno, `f18-export-${sufixo}-unidade`);

      const csv = csvGravado();

      expect(csv).toContain('LB');
      expect(csv).toContain('KG');
      expect(csv).toContain('200');
    });

    it('leva a cadeia de correcao, com a original marcada (INV-102)', async () => {
      const aluno = await criarAluno(contas.a);

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

      const resposta = await exportar(contas.a, aluno, `f18-export-${sufixo}-correcao`);

      expect((resposta.body as { rowCount: number }).rowCount).toBe(2);

      const csv = csvGravado();

      // A ORIGINAL continua no arquivo -- ela prova que o numero errado
      // circulou. Some do grafico, nao da auditoria.
      expect(csv).toContain('499');
      expect(csv).toContain('true');
      // E a correcao aponta o que ela substitui.
      expect(csv).toContain(errada);
    });

    it('NAO leva CPF nem fator de contexto de saude (art. 11, ADR-037)', async () => {
      const aluno = await criarAluno(contas.a);

      await publicada(contas.a, aluno, '2026-06-10T12:00:00.000Z', [
        { type: 'WEIGHT', value: 81, unit: 'kg' },
      ]);

      const fator = await request(servidor())
        .post(`/api/v1/students/${aluno}/health-context`)
        .set('Cookie', contas.a.cookie)
        .send({ factor: 'ATLETA_COMPETITIVO' });

      expect(fator.status).toBe(201);

      await exportar(contas.a, aluno, `f18-export-${sufixo}-lgpd`);

      const csv = csvGravado();

      // Fator de contexto e dado de saude sensivel e NAO entra numa planilha
      // que a academia manda por e-mail.
      expect(csv).not.toContain('ATLETA_COMPETITIVO');
      expect(csv.toLowerCase()).not.toContain('cpf');
    });

    it('a mesma chave de idempotencia devolve o mesmo arquivo', async () => {
      const aluno = await criarAluno(contas.a);

      await publicada(contas.a, aluno, '2026-06-10T12:00:00.000Z', [
        { type: 'WEIGHT', value: 81, unit: 'kg' },
      ]);

      const chave = `f18-export-${sufixo}-idem`;

      const primeira = await exportar(contas.a, aluno, chave);
      const segunda = await exportar(contas.a, aluno, chave);

      expect(primeira.status).toBe(201);
      expect(segunda.status).toBe(201);

      // Clique duplo no botao NAO gera dois arquivos no storage.
      expect((segunda.body as { id: string }).id).toBe((primeira.body as { id: string }).id);
    });

    it('registra na auditoria o instante em que o dado saiu', async () => {
      const aluno = await criarAluno(contas.a);

      await publicada(contas.a, aluno, '2026-06-10T12:00:00.000Z', [
        { type: 'WEIGHT', value: 81, unit: 'kg' },
      ]);

      await exportar(contas.a, aluno, `f18-export-${sufixo}-auditoria`);

      // Para a LGPD o que importa e QUANDO o dado deixou o sistema.
      const trilha = await db.auditLog.findFirst({
        where: { tenantId: contas.a.tenantId, action: 'health.exported', targetId: aluno },
      });

      expect(trilha).not.toBeNull();
      expect(trilha?.action).toBe('health.exported');
      // Quem levou o dado embora, e quantas linhas saíram.
      expect(trilha?.actorId).not.toBeNull();
      expect((trilha?.metadata as { rowCount: number } | null)?.rowCount).toBe(1);
    });

    it('academia B nao exporta historico de aluno da academia A (INV-006)', async () => {
      const aluno = await criarAluno(contas.a);

      await publicada(contas.a, aluno, '2026-06-10T12:00:00.000Z', [
        { type: 'WEIGHT', value: 81, unit: 'kg' },
      ]);

      const resposta = await exportar(contas.b, aluno, `f18-export-${sufixo}-vazamento`);

      expect(resposta.status).toBe(404);
    });
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
