import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { Prisma } from '@arenahub/database';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Task 8 -- contrato de evolucao corporal para app e totem.
 *
 * O que este arquivo prova, e que teste de funcao pura nao alcanca:
 *
 *   - as CINCO regioes sempre aparecem, mesmo sem medida (INV-104);
 *   - a leitura (cor) ja vem RESOLVIDA do servidor -- nunca calculada no
 *     cliente (topo de `domain/leitura-de-faixa.ts`);
 *   - so analise PUBLICADA chega ao cliente -- REJEITADA/FAILED nunca;
 *   - isolamento entre tenants (INV-006).
 */
describe('Task 8 -- contrato de evolucao corporal', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: { email: `t8-a-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '', userId: '' },
    b: { email: `t8-b-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '', userId: '' },
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
    conta: (typeof contas)['a'],
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
    conta.userId = user.id;
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

  /** Cria e publica numa tacada. */
  const publicada = async (
    conta: (typeof contas)['a'],
    studentId: string,
    assessedAt: string,
    medidas: MedidaEnviada[],
  ): Promise<string> => {
    const rascunho = await request(servidor())
      .post(`/api/v1/students/${studentId}/assessments`)
      .set('Cookie', conta.cookie)
      .send({ assessedAt, measurements: medidas });

    expect(rascunho.status).toBe(201);

    const id = (rascunho.body as { id: string }).id;

    const resposta = await request(servidor())
      .post(`/api/v1/assessments/${id}/publish`)
      .set('Cookie', conta.cookie)
      .send({});

    expect(resposta.status).toBe(201);

    return id;
  };

  interface MedidaDaRegiaoResposta {
    fatMassKg: number | null;
    muscleMassKg: number | null;
    fatReading: string;
    muscleReading: string;
  }

  interface MesResposta {
    assessedAtLocal: string;
    regions: Record<string, MedidaDaRegiaoResposta>;
    metrics: { type: string; value: number; unit: string | null; reading: string }[];
  }

  interface EvolucaoResposta {
    months: MesResposta[];
    latestAnalysis: { positivePoints: string[]; attentionPoints: string[]; disclaimerCode: string } | null;
  }

  const evolucao = async (
    conta: (typeof contas)['a'],
    studentId: string,
    periodo = 'ALL',
  ): Promise<request.Response> =>
    request(servidor())
      .get(`/api/v1/students/${studentId}/body-evolution?period=${periodo}`)
      .set('Cookie', conta.cookie);

  /** Grava uma AiAnalysis diretamente no banco, no estado pedido. */
  const gravarAnalise = async (
    conta: (typeof contas)['a'],
    studentId: string,
    status: 'PUBLISHED' | 'REJECTED' | 'FAILED',
    output: Record<string, unknown> | null,
  ): Promise<void> => {
    const promptId = await db.aiPromptVersion.upsert({
      where: { name: 'analise-de-saude-teste' },
      create: {
        name: 'analise-de-saude-teste',
        content: 'prompt de teste',
        contentSha256: 'a'.repeat(64),
      },
      update: {},
      select: { id: true },
    });

    await db.aiAnalysis.create({
      data: {
        tenantId: conta.tenantId,
        studentId,
        status,
        analysisRef: `an_${randomUUID().replace(/-/g, '')}`,
        snapshot: {},
        ...(output ? { output: output as unknown as Prisma.InputJsonObject } : {}),
        rejectionReason: status === 'PUBLISHED' ? null : 'DIAGNOSTIC_LANGUAGE',
        rejectionDetail: status === 'PUBLISHED' ? null : 'motivo de teste',
        promptVersionId: promptId.id,
        model: 'modelo-de-teste',
        costMicros: 0,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        requestedByUserId: conta.userId,
      },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);

    await montarAcademia(contas.a, `t8-academia-a-${sufixo}`);
    await montarAcademia(contas.b, `t8-academia-b-${sufixo}`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('devolve as 5 regioes com leitura ja resolvida', async () => {
    const aluno = await criarAluno(contas.a);

    await publicada(contas.a, aluno, '2026-01-10T12:00:00.000Z', [
      { type: 'SEGMENTAL_FAT_MASS_TRUNK', value: 20, unit: 'kg' },
      { type: 'SEGMENTAL_MUSCLE_MASS_TRUNK', value: 25, unit: 'kg' },
    ]);

    const resposta = await evolucao(contas.a, aluno, 'ALL');

    expect(resposta.status).toBe(200);

    const corpo = resposta.body as EvolucaoResposta;

    expect(Object.keys(corpo.months[0]?.regions ?? {}).sort()).toEqual([
      'ARM_LEFT',
      'ARM_RIGHT',
      'LEG_LEFT',
      'LEG_RIGHT',
      'TRUNK',
    ]);

    // Sem faixa do fabricante (medida MANUAL): leitura cai para UNKNOWN --
    // nunca WITHIN por padrao (INV-104).
    expect(corpo.months[0]?.regions['TRUNK']?.fatReading).toBe('UNKNOWN');
    expect(corpo.months[0]?.regions['TRUNK']?.fatMassKg).toBe(20);
  });

  it('regiao sem medida vem null, nunca zero (INV-104)', async () => {
    const aluno = await criarAluno(contas.a);

    // So braco esquerdo medido -- as outras quatro regioes ficam ausentes.
    await publicada(contas.a, aluno, '2026-01-10T12:00:00.000Z', [
      { type: 'SEGMENTAL_FAT_MASS_ARM_LEFT', value: 1.2, unit: 'kg' },
    ]);

    const resposta = await evolucao(contas.a, aluno, 'ALL');
    const corpo = resposta.body as EvolucaoResposta;
    const mes = corpo.months[0];

    expect(mes).toBeDefined();
    expect(mes?.regions['ARM_RIGHT']?.fatMassKg).toBeNull();
    expect(mes?.regions['ARM_RIGHT']?.muscleMassKg).toBeNull();
    expect(mes?.regions['ARM_RIGHT']?.fatReading).toBe('UNKNOWN');
    expect(mes?.regions['ARM_RIGHT']?.muscleReading).toBe('UNKNOWN');

    // Nenhum valor de regiao ausente virou zero.
    expect(mes?.regions['ARM_RIGHT']?.fatMassKg).not.toBe(0);
  });

  it('traz os pontos positivos da analise publicada, com o aviso', async () => {
    const aluno = await criarAluno(contas.a);

    await publicada(contas.a, aluno, '2026-01-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 80, unit: 'kg' },
    ]);

    await gravarAnalise(contas.a, aluno, 'PUBLISHED', {
      summary: 'resumo de teste',
      progress: [],
      positivePoints: ['constancia nos treinos'],
      attentionPoints: [],
      trends: [],
      goalProgress: [],
      questionsForProfessional: [],
      disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS',
      pendingMedicalReferral: false,
      pendingReferralSince: null,
      contextFactors: [],
      suppressedFindings: [],
      analysisBlocked: false,
    });

    const resposta = await evolucao(contas.a, aluno, 'ALL');
    const corpo = resposta.body as EvolucaoResposta;

    expect(corpo.latestAnalysis?.positivePoints.length).toBeGreaterThan(0);
    expect(corpo.latestAnalysis?.disclaimerCode).toBe('NOT_MEDICAL_DIAGNOSIS');
  });

  it('NAO devolve analise rejeitada nem falha', async () => {
    const aluno = await criarAluno(contas.a);

    await publicada(contas.a, aluno, '2026-01-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 80, unit: 'kg' },
    ]);

    await gravarAnalise(contas.a, aluno, 'REJECTED', null);
    await gravarAnalise(contas.a, aluno, 'FAILED', null);

    const resposta = await evolucao(contas.a, aluno, 'ALL');
    const corpo = resposta.body as EvolucaoResposta;

    expect(corpo.latestAnalysis).toBeNull();
  });

  it('nao vaza aluno de outro tenant', async () => {
    const aluno = await criarAluno(contas.a);

    await publicada(contas.a, aluno, '2026-01-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 80, unit: 'kg' },
    ]);

    const resposta = await evolucao(contas.b, aluno, 'ALL');

    expect(resposta.status).toBe(404);
  });

  it('periodo invalido responde 400 em vez de cair num padrao', async () => {
    const aluno = await criarAluno(contas.a);

    const resposta = await evolucao(contas.a, aluno, '60D');

    expect(resposta.status).toBe(400);
    expect((resposta.body as { code: string }).code).toBe('HEALTH_INVALID_PERIOD');
  });

  it('metrica nao segmentar (peso) entra em `metrics`, nunca em `regions`', async () => {
    const aluno = await criarAluno(contas.a);

    await publicada(contas.a, aluno, '2026-01-10T12:00:00.000Z', [
      { type: 'WEIGHT', value: 80, unit: 'kg' },
    ]);

    const corpo = (await evolucao(contas.a, aluno, 'ALL')).body as EvolucaoResposta;
    const mes = corpo.months[0];

    expect(mes?.metrics.find((m) => m.type === 'WEIGHT')?.value).toBe(80);
  });

  it('correcao substitui a original no mes -- so a folha aparece (INV-102)', async () => {
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

    const corpo = (await evolucao(contas.a, aluno, 'ALL')).body as EvolucaoResposta;

    // Um mes so -- a original nao aparece separada da correcao.
    expect(corpo.months).toHaveLength(1);
    expect(corpo.months[0]?.metrics.find((m) => m.type === 'WEIGHT')?.value).toBe(81);
  });
});
