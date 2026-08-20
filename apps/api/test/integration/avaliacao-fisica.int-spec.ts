import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F17 -- avaliacao fisica manual, pela porta da frente.
 *
 * O que este arquivo prova, e que teste de funcao pura nao alcanca:
 *
 *   - avaliacao PUBLICADA nao aceita edicao por nenhuma rota (INV-102);
 *   - correcao cria linha nova e a original CONTINUA publicada (INV-102);
 *   - a segunda correcao do mesmo original e recusada;
 *   - campo ausente permanece ausente -- nao vira `0` nem linha (INV-104);
 *   - a unidade original sobrevive a conversao, no banco (INV-105);
 *   - fator de contexto suprime aviso e gestante bloqueia (ADR-037);
 *   - isolamento entre tenants nas rotas novas (INV-006);
 *   - avaliacao NAO exige consentimento -- a F17 nao tem essa trava.
 */
describe('F17 -- avaliacao fisica manual', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: { email: `f17-a-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
    b: { email: `f17-b-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
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

  const MEDIDAS_PADRAO: MedidaEnviada[] = [
    { type: 'WEIGHT', value: 69.7, unit: 'kg' },
    { type: 'HEIGHT', value: 178, unit: 'cm' },
  ];

  const criarRascunho = async (
    conta: (typeof contas)['a'],
    studentId: string,
    medidas: MedidaEnviada[] = MEDIDAS_PADRAO,
  ): Promise<request.Response> =>
    request(servidor())
      .post(`/api/v1/students/${studentId}/assessments`)
      .set('Cookie', conta.cookie)
      .send({ assessedAt: '2026-08-20T12:00:00.000Z', measurements: medidas });

  const publicar = async (
    conta: (typeof contas)['a'],
    assessmentId: string,
  ): Promise<request.Response> =>
    request(servidor())
      .post(`/api/v1/assessments/${assessmentId}/publish`)
      .set('Cookie', conta.cookie)
      .send({});

  /** Cria e publica numa tacada -- o caminho feliz da recepcao. */
  const publicada = async (
    conta: (typeof contas)['a'],
    studentId: string,
    medidas: MedidaEnviada[] = MEDIDAS_PADRAO,
  ): Promise<string> => {
    const rascunho = await criarRascunho(conta, studentId, medidas);
    expect(rascunho.status).toBe(201);

    const id = (rascunho.body as { id: string }).id;
    const resposta = await publicar(conta, id);
    expect(resposta.status).toBe(201);

    return id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);

    await montarAcademia(contas.a, `f17-academia-a-${sufixo}`);
    await montarAcademia(contas.b, `f17-academia-b-${sufixo}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('registro e publicacao', () => {
    it('registra avaliacao SEM exigir consentimento nenhum', async () => {
      // A trava que a F8 tem para biometria NAO existe aqui: peso e medidas a
      // academia ja coleta ha anos como parte do servico contratado. Nenhum
      // termo foi publicado neste teste, de proposito.
      const aluno = await criarAluno(contas.a);
      const resposta = await criarRascunho(contas.a, aluno);

      expect(resposta.status).toBe(201);
      expect((resposta.body as { status: string }).status).toBe('DRAFT');
    });

    it('preserva a unidade ORIGINAL no banco junto do canonico (INV-105)', async () => {
      const aluno = await criarAluno(contas.a);
      const id = await publicada(contas.a, aluno, [
        { type: 'WEIGHT', value: 154, unit: 'lb' },
      ]);

      const gravada = await db.bodyMeasurement.findFirstOrThrow({
        where: { assessmentId: id, type: 'WEIGHT' },
      });

      expect(gravada.originalUnit).toBe('LB');
      expect(gravada.originalValue.toNumber()).toBeCloseTo(154, 4);
      expect(gravada.canonicalUnit).toBe('KG');
      expect(gravada.canonicalValue.toNumber()).toBeCloseTo(69.853, 3);
    });

    it('campo ausente nao vira linha nem zero (INV-104)', async () => {
      const aluno = await criarAluno(contas.a);
      const id = await publicada(contas.a, aluno, [
        { type: 'WEIGHT', value: 69.7, unit: 'kg' },
      ]);

      const linhas = await db.bodyMeasurement.findMany({ where: { assessmentId: id } });

      // Uma medida enviada, uma linha. Nao ha `BODY_FAT_PERCENT` valendo `0`.
      expect(linhas).toHaveLength(1);
      expect(linhas.map((linha) => linha.type)).toEqual(['WEIGHT']);
    });

    it('recusa medida fora da faixa de digitacao', async () => {
      const aluno = await criarAluno(contas.a);

      const resposta = await criarRascunho(contas.a, aluno, [
        { type: 'WEIGHT', value: 750, unit: 'kg' },
      ]);

      expect(resposta.status).toBe(422);
      expect((resposta.body as { code: string }).code).toBe('HEALTH_INVALID_MEASUREMENT');
    });

    it('recusa unidade de outra grandeza', async () => {
      const aluno = await criarAluno(contas.a);

      const resposta = await criarRascunho(contas.a, aluno, [
        { type: 'WEIGHT', value: 70, unit: 'cm' },
      ]);

      expect(resposta.status).toBe(422);
      expect((resposta.body as { code: string }).code).toBe('HEALTH_INCOMPATIBLE_UNIT');
    });
  });

  describe('imutabilidade (INV-102)', () => {
    it('rascunho aceita edicao', async () => {
      const aluno = await criarAluno(contas.a);
      const rascunho = await criarRascunho(contas.a, aluno);
      const id = (rascunho.body as { id: string }).id;

      const resposta = await request(servidor())
        .patch(`/api/v1/assessments/${id}/draft`)
        .set('Cookie', contas.a.cookie)
        .send({ measurements: [{ type: 'WEIGHT', value: 70.2, unit: 'kg' }] });

      expect(resposta.status).toBe(200);

      const linhas = await db.bodyMeasurement.findMany({ where: { assessmentId: id } });

      // Substituiu, nao acumulou: `HEIGHT` do rascunho anterior saiu.
      expect(linhas).toHaveLength(1);
      expect(linhas[0]?.canonicalValue.toNumber()).toBeCloseTo(70.2, 4);
    });

    it('PUBLICADA recusa edicao de rascunho', async () => {
      const aluno = await criarAluno(contas.a);
      const id = await publicada(contas.a, aluno);

      const resposta = await request(servidor())
        .patch(`/api/v1/assessments/${id}/draft`)
        .set('Cookie', contas.a.cookie)
        .send({ measurements: [{ type: 'WEIGHT', value: 99, unit: 'kg' }] });

      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('HEALTH_ASSESSMENT_IMMUTABLE');

      // E o valor no banco continua o publicado.
      const peso = await db.bodyMeasurement.findFirstOrThrow({
        where: { assessmentId: id, type: 'WEIGHT' },
      });

      expect(peso.canonicalValue.toNumber()).toBeCloseTo(69.7, 4);
    });

    it('publicar duas vezes nao move published_at', async () => {
      const aluno = await criarAluno(contas.a);
      const id = await publicada(contas.a, aluno);

      const antes = await db.bodyAssessment.findFirstOrThrow({ where: { id } });
      const resposta = await publicar(contas.a, id);

      expect(resposta.status).toBe(409);

      const depois = await db.bodyAssessment.findFirstOrThrow({ where: { id } });

      expect(depois.publishedAt?.toISOString()).toBe(antes.publishedAt?.toISOString());
    });

    it('editar e publicar em paralelo: o par (status, valor) nunca e incoerente (INV-102)', async () => {
      // ESTE TESTE JA ESTEVE ERRADO, e o CI foi quem mostrou. A primeira
      // versao reprovava qualquer `PUBLISHED` com o valor da edicao -- e
      // essa combinacao tem DUAS causas, so uma delas defeito:
      //
      //   ordem A (legitima)  edicao commita ENQUANTO e rascunho, publicar
      //                       vem depois e congela 99.9. Ninguem violou nada.
      //   ordem B (o defeito) publicar commita, e a edicao passa DEPOIS.
      //
      // Provado no banco com duas sessoes psql: na ordem A as duas transacoes
      // leem `DRAFT` -- as duas corretamente -- e o resultado e PUBLISHED com
      // 99.9. A maquina do CI, mais lenta, produz a ordem A que a minha nao
      // produzia: 1/10 la, 0/25 aqui.
      //
      // O que o INV-102 exige nao e "publicada nunca tem 99.9". E: **depois
      // de publicada, nada muda**. Entao o que se mede aqui e coerencia --
      // a edicao ou foi recusada, ou entrou antes da publicacao -- e o teste
      // seguinte prova a metade sequencial, que e determinista.
      const aluno = await criarAluno(contas.a);
      let incoerentes = 0;

      for (let i = 0; i < 10; i += 1) {
        const rascunho = await criarRascunho(contas.a, aluno, [
          { type: 'WEIGHT', value: 69.7, unit: 'kg' },
        ]);
        const id = (rascunho.body as { id: string }).id;

        const [publicacao, edicao] = await Promise.all([
          publicar(contas.a, id),
          request(servidor())
            .patch(`/api/v1/assessments/${id}/draft`)
            .set('Cookie', contas.a.cookie)
            .send({ measurements: [{ type: 'WEIGHT', value: 99.9, unit: 'kg' }] }),
        ]);

        const final = await db.bodyAssessment.findFirstOrThrow({
          where: { id },
          include: { measurements: true },
        });

        const peso = final.measurements.find((medida) => medida.type === 'WEIGHT');
        const valor = peso?.canonicalValue.toNumber();

        // A INCOERENCIA que denuncia o defeito: a edicao foi ACEITA (200) e
        // mesmo assim a avaliacao terminou publicada com o valor dela. Isso
        // so acontece se a edicao passou DEPOIS da publicacao -- que e
        // exatamente o que a trava impede.
        const edicaoAceita = edicao.status === 200;
        const publicouComValorDaEdicao =
          final.status === 'PUBLISHED' && valor === 99.9;

        if (edicaoAceita && publicouComValorDaEdicao && publicacao.status === 201) {
          // Ordem A tambem cai aqui, entao confirma pelo instante: edicao
          // legitima acontece ANTES do carimbo de publicacao.
          const medida = peso;

          if (
            medida &&
            final.publishedAt &&
            medida.createdAt.getTime() > final.publishedAt.getTime()
          ) {
            incoerentes += 1;
          }
        }

        // Invariante que vale em TODA ordem: publicada tem carimbo, rascunho nao.
        expect(final.status === 'PUBLISHED').toBe(final.publishedAt !== null);
      }

      expect(incoerentes).toBe(0);
    });

    it('editar DEPOIS de publicada e sempre recusado, e o valor nao muda (INV-102)', async () => {
      // A metade determinista, e a que de fato prova o invariante: uma vez
      // publicada, a rota de rascunho recusa e o numero permanece.
      const aluno = await criarAluno(contas.a);

      for (let i = 0; i < 5; i += 1) {
        const id = await publicada(contas.a, aluno, [
          { type: 'WEIGHT', value: 69.7, unit: 'kg' },
        ]);

        const edicao = await request(servidor())
          .patch(`/api/v1/assessments/${id}/draft`)
          .set('Cookie', contas.a.cookie)
          .send({ measurements: [{ type: 'WEIGHT', value: 99.9, unit: 'kg' }] });

        expect(edicao.status).toBe(409);

        const peso = await db.bodyMeasurement.findFirstOrThrow({
          where: { assessmentId: id, type: 'WEIGHT' },
        });

        expect(peso.canonicalValue.toNumber()).toBeCloseTo(69.7, 4);
      }
    });

    it('recusa publicar rascunho sem medida', async () => {
      // A rota exige `min(1)`, entao o caminho para uma avaliacao vazia e
      // apagar as medidas por fora -- o que um import interrompido faria.
      const aluno = await criarAluno(contas.a);
      const rascunho = await criarRascunho(contas.a, aluno);
      const id = (rascunho.body as { id: string }).id;

      await db.bodyMeasurement.deleteMany({ where: { assessmentId: id } });

      const resposta = await publicar(contas.a, id);

      expect(resposta.status).toBe(422);
      expect((resposta.body as { code: string }).code).toBe('HEALTH_ASSESSMENT_EMPTY');
    });
  });

  describe('correcao vinculada (INV-102)', () => {
    it('cria linha nova e deixa a original publicada', async () => {
      const aluno = await criarAluno(contas.a);
      const originalId = await publicada(contas.a, aluno);

      const resposta = await request(servidor())
        .post(`/api/v1/assessments/${originalId}/corrections`)
        .set('Cookie', contas.a.cookie)
        .send({
          assessedAt: '2026-08-20T12:00:00.000Z',
          notes: 'balanca estava descalibrada',
          measurements: [{ type: 'WEIGHT', value: 71.4, unit: 'kg' }],
        });

      expect(resposta.status).toBe(201);

      const correcao = resposta.body as {
        id: string;
        status: string;
        studentId: string;
        supersedesAssessmentId: string | null;
      };

      expect(correcao.id).not.toBe(originalId);
      expect(correcao.status).toBe('PUBLISHED');
      expect(correcao.supersedesAssessmentId).toBe(originalId);
      // O aluno vem da ORIGINAL, nao do corpo.
      expect(correcao.studentId).toBe(aluno);

      const original = await db.bodyAssessment.findFirstOrThrow({ where: { id: originalId } });

      // A errada continua publicada e visivel: apagar destruiria a prova de
      // que o numero errado circulou.
      expect(original.status).toBe('PUBLISHED');

      const pesoOriginal = await db.bodyMeasurement.findFirstOrThrow({
        where: { assessmentId: originalId, type: 'WEIGHT' },
      });

      expect(pesoOriginal.canonicalValue.toNumber()).toBeCloseTo(69.7, 4);
    });

    it('recusa a segunda correcao do mesmo original', async () => {
      const aluno = await criarAluno(contas.a);
      const originalId = await publicada(contas.a, aluno);

      const corpo = {
        assessedAt: '2026-08-20T12:00:00.000Z',
        measurements: [{ type: 'WEIGHT', value: 71.4, unit: 'kg' }],
      };

      const primeira = await request(servidor())
        .post(`/api/v1/assessments/${originalId}/corrections`)
        .set('Cookie', contas.a.cookie)
        .send(corpo);

      expect(primeira.status).toBe(201);

      const segunda = await request(servidor())
        .post(`/api/v1/assessments/${originalId}/corrections`)
        .set('Cookie', contas.a.cookie)
        .send(corpo);

      expect(segunda.status).toBe(409);
      expect((segunda.body as { code: string }).code).toBe('HEALTH_ASSESSMENT_IMMUTABLE');
    });

    it('recusa corrigir rascunho', async () => {
      const aluno = await criarAluno(contas.a);
      const rascunho = await criarRascunho(contas.a, aluno);
      const id = (rascunho.body as { id: string }).id;

      const resposta = await request(servidor())
        .post(`/api/v1/assessments/${id}/corrections`)
        .set('Cookie', contas.a.cookie)
        .send({
          assessedAt: '2026-08-20T12:00:00.000Z',
          measurements: [{ type: 'WEIGHT', value: 71.4, unit: 'kg' }],
        });

      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('HEALTH_ASSESSMENT_NOT_PUBLISHED');
    });
  });

  describe('contexto de saude (ADR-037)', () => {
    it('fator ativo suprime o aviso correspondente', async () => {
      const aluno = await criarAluno(contas.a);

      const resposta = await request(servidor())
        .post(`/api/v1/students/${aluno}/health-context`)
        .set('Cookie', contas.a.cookie)
        .send({ factor: 'SUPLEMENTACAO_CREATINA' });

      expect(resposta.status).toBe(201);

      const contexto = resposta.body as {
        factors: string[];
        suppressedWarnings: string[];
        analysisBlocked: boolean;
      };

      expect(contexto.factors).toEqual(['SUPLEMENTACAO_CREATINA']);
      expect(contexto.suppressedWarnings).toContain('INTRACELLULAR_WATER_HIGH');
      expect(contexto.analysisBlocked).toBe(false);
    });

    it('gestante bloqueia a analise sem impedir o registro', async () => {
      const aluno = await criarAluno(contas.a);

      await request(servidor())
        .post(`/api/v1/students/${aluno}/health-context`)
        .set('Cookie', contas.a.cookie)
        .send({ factor: 'GESTANTE_OU_POS_PARTO' });

      const contexto = await request(servidor())
        .get(`/api/v1/students/${aluno}/health-context`)
        .set('Cookie', contas.a.cookie);

      expect((contexto.body as { analysisBlocked: boolean }).analysisBlocked).toBe(true);

      // Bloquear a ANALISE nao bloqueia a AVALIACAO: registrar segue valendo.
      const rascunho = await criarRascunho(contas.a, aluno);

      expect(rascunho.status).toBe(201);
    });

    it('ativar o mesmo fator duas vezes nao duplica', async () => {
      const aluno = await criarAluno(contas.a);

      for (let i = 0; i < 2; i += 1) {
        await request(servidor())
          .post(`/api/v1/students/${aluno}/health-context`)
          .set('Cookie', contas.a.cookie)
          .send({ factor: 'ATLETA_COMPETITIVO' });
      }

      const linhas = await db.studentHealthContext.findMany({
        where: { studentId: aluno, factor: 'ATLETA_COMPETITIVO', deactivatedAt: null },
      });

      expect(linhas).toHaveLength(1);
    });

    it('ativar o mesmo fator EM PARALELO nao duplica', async () => {
      // Sequencial nao prova nada: a segunda leitura ja enxerga o commit da
      // primeira. Quem garante e o indice parcial, nao o `if (jaAtivo)` --
      // duas requisicoes simultaneas leem as duas `null` e as duas criam.
      const aluno = await criarAluno(contas.a);

      await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          request(servidor())
            .post(`/api/v1/students/${aluno}/health-context`)
            .set('Cookie', contas.a.cookie)
            .send({ factor: 'COMPOSICAO_ATIPICA' }),
        ),
      );

      const linhas = await db.studentHealthContext.findMany({
        where: { studentId: aluno, factor: 'COMPOSICAO_ATIPICA', deactivatedAt: null },
      });

      expect(linhas).toHaveLength(1);
    });

    it('reativar fator ja desativado e permitido -- o historico repete', async () => {
      // O indice e PARCIAL de proposito: gestante que engravida de novo,
      // atleta que volta a competir. `@@unique` cheio bloquearia os dois.
      const aluno = await criarAluno(contas.a);
      const rota = `/api/v1/students/${aluno}/health-context`;

      await request(servidor())
        .post(rota)
        .set('Cookie', contas.a.cookie)
        .send({ factor: 'GESTANTE_OU_POS_PARTO' });

      await request(servidor())
        .delete(`${rota}/GESTANTE_OU_POS_PARTO`)
        .set('Cookie', contas.a.cookie);

      const reativado = await request(servidor())
        .post(rota)
        .set('Cookie', contas.a.cookie)
        .send({ factor: 'GESTANTE_OU_POS_PARTO' });

      expect(reativado.status).toBe(201);
      expect((reativado.body as { analysisBlocked: boolean }).analysisBlocked).toBe(true);

      const todas = await db.studentHealthContext.findMany({
        where: { studentId: aluno, factor: 'GESTANTE_OU_POS_PARTO' },
      });

      // Duas linhas: a desativada e a nova. O historico nao foi reescrito.
      expect(todas).toHaveLength(2);
    });

    it('desativar preserva a linha para o snapshot da F21', async () => {
      const aluno = await criarAluno(contas.a);

      await request(servidor())
        .post(`/api/v1/students/${aluno}/health-context`)
        .set('Cookie', contas.a.cookie)
        .send({ factor: 'EDEMA_RELATADO' });

      const resposta = await request(servidor())
        .delete(`/api/v1/students/${aluno}/health-context/EDEMA_RELATADO`)
        .set('Cookie', contas.a.cookie);

      expect(resposta.status).toBe(200);
      expect((resposta.body as { factors: string[] }).factors).toEqual([]);

      // A linha continua existindo, com carimbo de desativacao.
      const linha = await db.studentHealthContext.findFirstOrThrow({
        where: { studentId: aluno, factor: 'EDEMA_RELATADO' },
      });

      expect(linha.deactivatedAt).not.toBeNull();
    });

    it('recusa fator fora da lista fechada', async () => {
      const aluno = await criarAluno(contas.a);

      const resposta = await request(servidor())
        .post(`/api/v1/students/${aluno}/health-context`)
        .set('Cookie', contas.a.cookie)
        .send({ factor: 'JEJUM_INTERMITENTE' });

      expect(resposta.status).toBe(400);
    });
  });

  describe('isolamento entre tenants (INV-006)', () => {
    it('a academia B nao enxerga avaliacao da academia A', async () => {
      const aluno = await criarAluno(contas.a);
      const id = await publicada(contas.a, aluno);

      const resposta = await request(servidor())
        .get(`/api/v1/assessments/${id}`)
        .set('Cookie', contas.b.cookie);

      expect(resposta.status).toBe(404);
    });

    it('a academia B nao corrige avaliacao da academia A', async () => {
      const aluno = await criarAluno(contas.a);
      const id = await publicada(contas.a, aluno);

      const resposta = await request(servidor())
        .post(`/api/v1/assessments/${id}/corrections`)
        .set('Cookie', contas.b.cookie)
        .send({
          assessedAt: '2026-08-20T12:00:00.000Z',
          measurements: [{ type: 'WEIGHT', value: 50, unit: 'kg' }],
        });

      // 404 e nao 409: responder conflito para id de OUTRO tenant vazaria
      // que aquele id existe em algum lugar.
      expect(resposta.status).toBe(404);
      expect((resposta.body as { code: string }).code).toBe('HEALTH_ASSESSMENT_NOT_FOUND');

      const peso = await db.bodyMeasurement.findFirstOrThrow({
        where: { assessmentId: id, type: 'WEIGHT' },
      });

      expect(peso.canonicalValue.toNumber()).toBeCloseTo(69.7, 4);
    });
  });
});
