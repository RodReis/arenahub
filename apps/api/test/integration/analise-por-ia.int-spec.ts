import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { FakeAiProviderAdapter } from '../../src/modules/health/provider/fake-ai-provider.adapter.js';
import { ErroDaIa } from '../../src/modules/health/provider/ai-provider.port.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F21 -- analise assistiva por IA, pela porta da frente.
 *
 * O que este arquivo prova, e que teste de funcao pura NAO alcanca:
 *
 *   - o aceite e DUPLO: aluno E professor, nessa ordem (decisao do PI, 21/08);
 *   - o endosso do professor NAO substitui o consentimento do aluno -- o
 *     defeito que a F8 teria produzido se o repositorio fosse reusado;
 *   - sem aceite, nenhum dado sai: 403 antes de qualquer leitura de saude;
 *   - saida com diagnostico e REJEITADA e REGISTRADA (`M3-AC-008`), e o texto
 *     recusado NAO fica gravado -- a constraint do banco garante;
 *   - o snapshot gravado nao carrega PII (`M3-NFR-009`) -- conferido no
 *     proprio JSON persistido;
 *   - indisponibilidade da IA nao derruba nada (`M3-NFR-004`);
 *   - isolamento entre tenants (INV-006).
 */
describe('F21 -- analise assistiva por IA', () => {
  let app: INestApplication;
  let db: PrismaService;
  let fake: FakeAiProviderAdapter;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: {
      email: `f21-a-${sufixo}@exemplo.test`,
      tenantId: '',
      gymUnitId: '',
      cookie: '',
      userId: '',
      documentoId: '',
    },
    b: {
      email: `f21-b-${sufixo}@exemplo.test`,
      tenantId: '',
      gymUnitId: '',
      cookie: '',
      userId: '',
      documentoId: '',
    },
  };

  const PERMISSOES = ['student.create', 'student.read', 'health.read', 'health.assess'];

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

    const documento = await db.consentDocument.create({
      data: {
        tenantId: tenant.id,
        type: 'AI_ANALYSIS',
        version: 1,
        purpose: 'Envio de medidas a provedor de IA para gerar resumo de acompanhamento',
        content: 'Termo de analise por IA. '.repeat(5),
        contentSha256: 'c'.repeat(64),
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: conta.email, password: SENHA });

    conta.tenantId = tenant.id;
    conta.gymUnitId = unidade.id;
    conta.userId = user.id;
    conta.documentoId = documento.id;
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

  /** Grava uma assinatura do aceite direto no banco -- a tela e outra fatia. */
  const assinar = async (
    conta: (typeof contas)['a'],
    studentId: string,
    papel: 'STUDENT_CONSENT' | 'PROFESSIONAL_ENDORSEMENT',
    decisao: 'ACCEPTED' | 'REFUSED' = 'ACCEPTED',
    quando = new Date('2026-08-20T10:00:00.000Z'),
  ): Promise<void> => {
    await db.consentRecord.create({
      data: {
        tenantId: conta.tenantId,
        studentId,
        documentId: conta.documentoId,
        decision: decisao,
        signerRole: papel,
        subjectKind: 'STUDENT',
        subjectAgeYears: 36,
        actorId: conta.userId,
        occurredAt: quando,
      },
    });
  };

  const publicar = async (
    conta: (typeof contas)['a'],
    studentId: string,
    assessedAt: string,
    peso: number,
  ): Promise<void> => {
    const rascunho = await request(servidor())
      .post(`/api/v1/students/${studentId}/assessments`)
      .set('Cookie', conta.cookie)
      .send({ assessedAt, measurements: [{ type: 'WEIGHT', value: peso, unit: 'kg' }] });

    expect(rascunho.status).toBe(201);

    const publicacao = await request(servidor())
      .post(`/api/v1/assessments/${(rascunho.body as { id: string }).id}/publish`)
      .set('Cookie', conta.cookie)
      .send({});

    expect(publicacao.status).toBe(201);
  };

  const gerar = async (
    conta: (typeof contas)['a'],
    studentId: string,
  ): Promise<request.Response> =>
    request(servidor())
      .post(`/api/v1/students/${studentId}/ai-analyses`)
      .set('Cookie', conta.cookie)
      .send({});

  /** Aluno com as duas assinaturas e uma serie publicada. */
  const alunoPronto = async (conta: (typeof contas)['a']): Promise<string> => {
    const aluno = await criarAluno(conta);

    await assinar(conta, aluno, 'STUDENT_CONSENT', 'ACCEPTED', new Date('2026-08-19T10:00:00Z'));
    await assinar(
      conta,
      aluno,
      'PROFESSIONAL_ENDORSEMENT',
      'ACCEPTED',
      new Date('2026-08-20T10:00:00Z'),
    );

    await publicar(conta, aluno, '2026-01-10T12:00:00.000Z', 90);
    await publicar(conta, aluno, '2026-06-10T12:00:00.000Z', 85);

    return aluno;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    fake = app.get(FakeAiProviderAdapter);

    await montarAcademia(contas.a, `f21-academia-a-${sufixo}`);
    await montarAcademia(contas.b, `f21-academia-b-${sufixo}`);
  });

  afterEach(() => {
    // A instancia do fake e compartilhada na suite: programar falha num bloco
    // e esquecer de limpar contamina o proximo.
    fake.resetar();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('o aceite DUPLO (M3-AC-007)', () => {
    it('gera a analise com as duas assinaturas', async () => {
      const aluno = await alunoPronto(contas.a);

      const resposta = await gerar(contas.a, aluno);

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ status: 'PUBLISHED' });
      expect((resposta.body as { analysis: { disclaimerCode: string } }).analysis.disclaimerCode)
        .toBe('NOT_MEDICAL_DIAGNOSIS');
    });

    it('sem assinatura nenhuma responde 403 e nao gera analise', async () => {
      const aluno = await criarAluno(contas.a);
      await publicar(contas.a, aluno, '2026-01-10T12:00:00.000Z', 90);

      const resposta = await gerar(contas.a, aluno);

      expect(resposta.status).toBe(403);
      expect((resposta.body as { code: string }).code).toBe('AI_CONSENT_MISSING_STUDENT');

      // Nada foi gravado: o aceite e conferido ANTES de qualquer leitura de
      // dado de saude.
      const analises = await db.aiAnalysis.count({ where: { studentId: aluno } });
      expect(analises).toBe(0);
    });

    it('so o aluno nao basta', async () => {
      const aluno = await criarAluno(contas.a);
      await assinar(contas.a, aluno, 'STUDENT_CONSENT');

      const resposta = await gerar(contas.a, aluno);

      expect(resposta.status).toBe(403);
      expect((resposta.body as { code: string }).code).toBe('AI_CONSENT_MISSING_PROFESSIONAL');
    });

    /**
     * Dado de saude e sensivel (LGPD art. 5, II) e o art. 11 e lista fechada:
     * so o TITULAR consente. A academia endossando sozinha nao autoriza nada.
     */
    it('so o professor NAO autoriza -- a academia nao consente pelo aluno', async () => {
      const aluno = await criarAluno(contas.a);
      await assinar(contas.a, aluno, 'PROFESSIONAL_ENDORSEMENT');

      const resposta = await gerar(contas.a, aluno);

      expect(resposta.status).toBe(403);
      expect((resposta.body as { code: string }).code).toBe('AI_CONSENT_MISSING_STUDENT');
    });

    it('recusa do aluno bloqueia mesmo com o professor aceitando', async () => {
      const aluno = await criarAluno(contas.a);
      await assinar(
        contas.a,
        aluno,
        'STUDENT_CONSENT',
        'REFUSED',
        new Date('2026-08-19T10:00:00Z'),
      );
      await assinar(contas.a, aluno, 'PROFESSIONAL_ENDORSEMENT');

      const resposta = await gerar(contas.a, aluno);

      expect((resposta.body as { code: string }).code).toBe('AI_CONSENT_REFUSED_STUDENT');
    });

    /**
     * ⚠️ O DEFEITO QUE ESTE TESTE EXISTE PARA IMPEDIR.
     *
     * `ConsentRepository.registrarDecisao` (F8) marca como substituida TODA
     * decisao viva do documento. Reusa-lo aqui faria o endosso do professor
     * apagar o consentimento do aluno -- e a autorizacao ficaria de pe com
     * uma assinatura so.
     */
    it('o endosso do professor NAO substitui o consentimento do aluno', async () => {
      const aluno = await alunoPronto(contas.a);

      const vivas = await db.consentRecord.findMany({
        where: { studentId: aluno, supersededAt: null },
        select: { signerRole: true },
      });

      expect(vivas).toHaveLength(2);
      expect(vivas.map((v) => v.signerRole).sort()).toEqual([
        'PROFESSIONAL_ENDORSEMENT',
        'STUDENT_CONSENT',
      ]);
    });
  });

  describe('o snapshot que atravessa a fronteira (M3-NFR-009)', () => {
    it('o payload gravado nao carrega nome, CPF nem identificador do aluno', async () => {
      const aluno = await alunoPronto(contas.a);
      await gerar(contas.a, aluno);

      const analise = await db.aiAnalysis.findFirstOrThrow({
        where: { studentId: aluno },
        select: { snapshot: true },
      });

      const serializado = JSON.stringify(analise.snapshot);

      // O vinculo com o aluno mora na COLUNA `student_id`, nunca dentro do
      // JSON que foi enviado ao provedor.
      expect(serializado).not.toContain(aluno);
      expect(serializado).not.toContain('Aluno De Teste');
      expect(serializado).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
      expect(serializado).not.toContain('1990-05-10');
    });

    it('a idade viaja em faixa, e o snapshot guarda a referencia opaca', async () => {
      const aluno = await alunoPronto(contas.a);
      await gerar(contas.a, aluno);

      const analise = await db.aiAnalysis.findFirstOrThrow({
        where: { studentId: aluno },
        select: { snapshot: true, analysisRef: true },
      });

      const snapshot = analise.snapshot as { ageRange: string; analysisRef: string };

      expect(snapshot.ageRange).toBe('30-39');
      // Opaca: nao deriva do aluno, entao nao reidentifica por correlacao.
      expect(analise.analysisRef).toMatch(/^an_[0-9a-f]{32}$/);
      expect(analise.analysisRef).not.toContain(aluno);
    });
  });

  describe('a regra de arquitetura no 8 (M3-BR-010, M3-AC-008)', () => {
    it('a analise publicada carrega o disclaimer', async () => {
      const aluno = await alunoPronto(contas.a);
      const resposta = await gerar(contas.a, aluno);

      const corpo = resposta.body as { analysis: { disclaimerCode: string } };
      expect(corpo.analysis.disclaimerCode).toBe('NOT_MEDICAL_DIAGNOSIS');
    });

    /**
     * A constraint do banco e a garantia final: mesmo que um bug tentasse
     * gravar o texto recusado, a linha nao entra.
     */
    it('o banco recusa gravar saida em analise REJEITADA', async () => {
      const aluno = await alunoPronto(contas.a);
      await gerar(contas.a, aluno);

      const promptId = (
        await db.aiPromptVersion.findFirstOrThrow({ select: { id: true } })
      ).id;

      await expect(
        db.aiAnalysis.create({
          data: {
            tenantId: contas.a.tenantId,
            studentId: aluno,
            status: 'REJECTED',
            analysisRef: `an_${randomUUID().replace(/-/g, '')}`,
            snapshot: {},
            // O texto que a regra no 8 recusou, tentando entrar "para
            // consulta".
            output: { summary: 'Voce tem obesidade.' },
            rejectionReason: 'DIAGNOSTIC_LANGUAGE',
            promptVersionId: promptId,
            model: 'x',
            costMicros: 0,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            requestedByUserId: contas.a.userId,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('indisponibilidade da IA (M3-NFR-004)', () => {
    it('falha do provedor vira registro FAILED, sem derrubar a requisicao', async () => {
      const aluno = await alunoPronto(contas.a);

      fake.programarFalha(
        new ErroDaIa('AI_PROVIDER_UNAVAILABLE', true, 'provedor fora do ar'),
      );

      const resposta = await gerar(contas.a, aluno);

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({
        status: 'FAILED',
        analysis: null,
        rejectionReason: 'AI_PROVIDER_UNAVAILABLE',
      });
    });

    it('a avaliacao manual continua funcionando com a IA fora do ar', async () => {
      const aluno = await alunoPronto(contas.a);

      fake.programarFalha(new ErroDaIa('AI_PROVIDER_TIMEOUT', true, 'estourou'));

      await gerar(contas.a, aluno);

      // O historico -- que nao chama IA nenhuma -- segue respondendo.
      const historico = await request(servidor())
        .get(`/api/v1/students/${aluno}/health-progress?period=ALL`)
        .set('Cookie', contas.a.cookie);

      expect(historico.status).toBe(200);
    });

    it('a falha e registrada para o teto de gasto poder contar', async () => {
      const aluno = await alunoPronto(contas.a);

      fake.programarFalha(new ErroDaIa('AI_BUDGET_EXCEEDED', false, 'teto estourado'));
      await gerar(contas.a, aluno);

      const falhas = await db.aiAnalysis.count({
        where: { studentId: aluno, status: 'FAILED' },
      });

      // O provedor cobra pela chamada, nao pelo resultado: sem o registro, o
      // `M3-NFR-005` nao teria o que somar.
      expect(falhas).toBeGreaterThan(0);
    });
  });

  describe('leitura -- o que totem e app consomem', () => {
    it('devolve a ultima analise publicada', async () => {
      const aluno = await alunoPronto(contas.a);
      await gerar(contas.a, aluno);

      const resposta = await request(servidor())
        .get(`/api/v1/students/${aluno}/ai-analyses/latest`)
        .set('Cookie', contas.a.cookie);

      expect(resposta.status).toBe(200);
      expect((resposta.body as { analysis: { summary: string } }).analysis.summary).not.toBe('');
    });

    it('aluno sem analise responde 404, e nao objeto vazio', async () => {
      const aluno = await criarAluno(contas.a);

      const resposta = await request(servidor())
        .get(`/api/v1/students/${aluno}/ai-analyses/latest`)
        .set('Cookie', contas.a.cookie);

      expect(resposta.status).toBe(404);
      expect((resposta.body as { code: string }).code).toBe('AI_ANALYSIS_NOT_FOUND');
    });

    it('analise FAILED nao aparece na leitura', async () => {
      const aluno = await alunoPronto(contas.a);

      fake.programarFalha(new ErroDaIa('AI_PROVIDER_UNAVAILABLE', true, 'fora'));
      await gerar(contas.a, aluno);
      fake.resetar();

      const resposta = await request(servidor())
        .get(`/api/v1/students/${aluno}/ai-analyses/latest`)
        .set('Cookie', contas.a.cookie);

      expect(resposta.status).toBe(404);
    });
  });

  describe('isolamento entre tenants (INV-006)', () => {
    it('a academia B nao gera analise de aluno da academia A', async () => {
      const aluno = await alunoPronto(contas.a);

      const resposta = await gerar(contas.b, aluno);

      // 404 e nao 403: 403 vazaria que aquele id existe em algum lugar.
      expect(resposta.status).toBe(404);
      expect((resposta.body as { code: string }).code).toBe('STUDENT_NOT_FOUND');
    });

    it('a academia B nao le a analise do aluno da academia A', async () => {
      const aluno = await alunoPronto(contas.a);
      await gerar(contas.a, aluno);

      const resposta = await request(servidor())
        .get(`/api/v1/students/${aluno}/ai-analyses/latest`)
        .set('Cookie', contas.b.cookie);

      expect(resposta.status).toBe(404);
    });
  });
});
