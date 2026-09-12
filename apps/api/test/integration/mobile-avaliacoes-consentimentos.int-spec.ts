import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Avaliacoes, consentimentos e exportacao pela porta HTTP -- F26, Slice 4.4.
 *
 * PELA PORTA HTTP, e nao no service: `students`, `body_assessments` e
 * `consent_records` tem RLS com FORCE, e sob o role restrito uma consulta
 * fora de transacao com contexto devolve ZERO LINHAS sem erro e sem log. Um
 * teste de service com duble passaria verde com a tela vazia -- e aqui a
 * tela vazia seria o historico de saude do aluno sumindo.
 */
describe('F26 -- Avaliacoes e consentimentos do app', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;

  const sufixo = randomUUID().slice(0, 8);
  const SLUG = `f26-${sufixo}`;
  const EMAIL = `aluno-f26-${sufixo}@exemplo.test`;
  const EMAIL_VIZINHO = `vizinho-f26-${sufixo}@exemplo.test`;
  const EMAIL_MENOR = `menor-f26-${sufixo}@exemplo.test`;
  const SENHA = 'senha-de-teste-longa';

  let tenantId: string;
  let unidadeId: string;
  let alunoId: string;
  let vizinhoId: string;
  let avaliadorId: string;

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  interface Consentimento {
    tipo: string;
    concedido: boolean;
    motivo: string | null;
    decididoEm: string | null;
    finalidade: string | null;
    versao: number | null;
    editavel: boolean;
  }

  interface CorpoDosConsentimentos {
    asOf: string;
    consentimentos: Consentimento[];
  }

  interface CorpoDoHistorico {
    asOf: string;
    periodo: string;
    series: {
      tipo: string;
      unidade: string | null;
      pontos: { avaliacaoId: string; medidaEm: string; valor: number }[];
      meta: { alvo: number; prazo: string } | null;
    }[];
    analise: { geradaEm: string; analise: { disclaimerCode: string } } | null;
  }

  interface CorpoDaExportacao {
    id: string;
    status: string;
    rowCount: number;
    errorCode: string | null;
    expiresAt: string | null;
  }

  const entrar = async (identificador = EMAIL): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/mobile/auth/login')
      .send({ tenantSlug: SLUG, identificador, senha: SENHA });

    return (resposta.body as { accessToken: string }).accessToken;
  };

  const criarAluno = async (
    identifier: string,
    nome: string,
    matricula: string,
    nascimento: Date,
  ): Promise<string> => {
    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId: unidadeId,
        membershipNumber: `${matricula}-${sufixo}`,
        fullName: nome,
        birthDate: nascimento,
      },
    });

    await db.studentAccount.create({
      data: {
        tenantId,
        studentId: aluno.id,
        identifier,
        passwordHash: await senhas.gerarHash(SENHA),
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    });

    return aluno.id;
  };

  /** Avaliacao PUBLICADA com uma medida -- o unico estado que o app enxerga. */
  const publicarAvaliacao = async (
    studentId: string,
    quando: Date,
    valor: string,
  ): Promise<string> => {
    const avaliacao = await db.bodyAssessment.create({
      data: {
        tenantId,
        studentId,
        status: 'PUBLISHED',
        assessedAt: quando,
        publishedAt: quando,
        source: 'MANUAL',
        evaluatorUserId: avaliadorId,
        measurements: {
          create: [
            {
              tenantId,
              type: 'WEIGHT',
              originalValue: valor,
              originalUnit: 'KG',
              canonicalValue: valor,
              canonicalUnit: 'KG',
            },
          ],
        },
      },
    });

    return avaliacao.id;
  };

  /** Termo vigente do tipo, com a versao 1. */
  const publicarTermo = async (type: 'TERMS' | 'HEALTH' | 'MARKETING'): Promise<string> => {
    const documento = await db.consentDocument.create({
      data: {
        tenantId,
        type,
        version: 1,
        purpose: `Finalidade de ${type} para a suite F26`,
        content: `Conteudo do termo ${type}`,
        contentSha256: randomUUID().replace(/-/g, ''),
        effectiveFrom: new Date(Date.now() - 86_400_000),
      },
    });

    return documento.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: { slug: SLUG, legalName: 'Academia F26 LTDA', displayName: 'Academia F26' },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `F26-${sufixo}`,
        name: 'Unidade F26',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    unidadeId = unidade.id;

    // `User` nao tem `tenantId`: o vinculo com a academia mora em
    // `TenantMembership`.
    const avaliador = await db.user.create({
      data: {
        email: `avaliador-${sufixo}@exemplo.test`,
        passwordHash: await senhas.gerarHash(SENHA),
      },
    });
    avaliadorId = avaliador.id;

    await db.tenantMembership.create({ data: { tenantId, userId: avaliadorId } });

    alunoId = await criarAluno(EMAIL, 'Joana Ribeiro Costa', 'F26A', new Date('1990-01-01'));
    vizinhoId = await criarAluno(EMAIL_VIZINHO, 'Pedro Santos Lima', 'F26B', new Date('1988-05-10'));

    // Menor de idade: nasceu ha 15 anos, contados do instante da suite para
    // que o teste nao envelheca e fique vermelho sozinho no CI.
    const quinzeAnos = new Date();
    quinzeAnos.setUTCFullYear(quinzeAnos.getUTCFullYear() - 15);
    await criarAluno(EMAIL_MENOR, 'Lucas Prado Alves', 'F26C', quinzeAnos);

    await publicarTermo('TERMS');
    await publicarTermo('HEALTH');
    await publicarTermo('MARKETING');

    // Duas medicoes do aluno, e UMA do vizinho: o teste de isolamento so
    // prova algo se existir dado do outro lado para vazar.
    await publicarAvaliacao(alunoId, new Date(Date.now() - 20 * 86_400_000), '80.5');
    await publicarAvaliacao(alunoId, new Date(Date.now() - 5 * 86_400_000), '78.2');
    await publicarAvaliacao(vizinhoId, new Date(Date.now() - 5 * 86_400_000), '95.0');
  });

  afterAll(async () => {
    if (tenantId) await db.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await app?.close();
  });

  describe('GET /api/v1/mobile/avaliacoes', () => {
    it('devolve a serie do aluno da SESSAO, em ordem, sem id na rota', async () => {
      const acesso = await entrar();

      const resposta = await request(servidor())
        .get('/api/v1/mobile/avaliacoes')
        .set('Authorization', `Bearer ${acesso}`);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as CorpoDoHistorico;
      const peso = corpo.series.find((s) => s.tipo === 'WEIGHT');

      expect(peso?.pontos).toHaveLength(2);
      expect(peso?.pontos.map((p) => p.valor)).toEqual([80.5, 78.2]);
    });

    it('NAO devolve avaliacao de outro aluno do mesmo tenant', async () => {
      const acesso = await entrar();

      const resposta = await request(servidor())
        .get('/api/v1/mobile/avaliacoes')
        .set('Authorization', `Bearer ${acesso}`);

      const corpo = resposta.body as CorpoDoHistorico;
      const valores = corpo.series.flatMap((s) => s.pontos.map((p) => p.valor));

      // 95.0 e a medida do vizinho. Aparecer aqui seria vazamento de dado de
      // saude entre alunos da MESMA academia.
      expect(valores).not.toContain(95);
    });

    it('`?studentId=` de outro aluno e IGNORADO -- o id sai da sessao', async () => {
      const acesso = await entrar();

      const resposta = await request(servidor())
        .get(`/api/v1/mobile/avaliacoes?studentId=${vizinhoId}`)
        .set('Authorization', `Bearer ${acesso}`);

      const corpo = resposta.body as CorpoDoHistorico;
      const valores = corpo.series.flatMap((s) => s.pontos.map((p) => p.valor));

      expect(valores).not.toContain(95);
      expect(valores).toContain(78.2);
    });

    it('sem analise publicada, `analise` e NULA -- a tela nao inventa texto', async () => {
      const acesso = await entrar();

      const resposta = await request(servidor())
        .get('/api/v1/mobile/avaliacoes')
        .set('Authorization', `Bearer ${acesso}`);

      expect((resposta.body as CorpoDoHistorico).analise).toBeNull();
    });

    it('sem sessao, recusa', async () => {
      const resposta = await request(servidor()).get('/api/v1/mobile/avaliacoes');

      expect(resposta.status).toBe(401);
    });
  });

  describe('GET /api/v1/mobile/consentimentos', () => {
    it('lista os tipos do app com a finalidade do termo vigente', async () => {
      const acesso = await entrar();

      const resposta = await request(servidor())
        .get('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as CorpoDosConsentimentos;
      const tipos = corpo.consentimentos.map((c) => c.tipo);

      expect(tipos).toEqual(
        expect.arrayContaining(['TERMS', 'PRIVACY', 'HEALTH', 'AI_ANALYSIS', 'MARKETING', 'RANKING']),
      );

      // BIOMETRIC nao entra: o cadastro biometrico e presencial, e revogar
      // implica exclusao fisica nos leitores, que este canal nao faz.
      expect(tipos).not.toContain('BIOMETRIC');

      const termos = corpo.consentimentos.find((c) => c.tipo === 'TERMS');
      expect(termos?.finalidade).toContain('TERMS');
      expect(termos?.versao).toBe(1);
    });

    it('OPT-IN nasce NEGADO e OPT-OUT nasce CONCEDIDO quando nunca houve decisao', async () => {
      const acesso = await entrar(EMAIL_VIZINHO);

      const resposta = await request(servidor())
        .get('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`);

      const corpo = resposta.body as CorpoDosConsentimentos;

      expect(corpo.consentimentos.find((c) => c.tipo === 'HEALTH')?.concedido).toBe(false);
      expect(corpo.consentimentos.find((c) => c.tipo === 'MARKETING')?.concedido).toBe(true);
    });

    it('menor de idade NAO decide sozinho (INV-143)', async () => {
      const acesso = await entrar(EMAIL_MENOR);

      const resposta = await request(servidor())
        .get('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`);

      const corpo = resposta.body as CorpoDosConsentimentos;

      expect(corpo.consentimentos.every((c) => c.editavel === false)).toBe(true);
    });
  });

  describe('PUT /api/v1/mobile/consentimentos', () => {
    it('concede, e a leitura seguinte ja reflete', async () => {
      const acesso = await entrar();

      const decisao = await request(servidor())
        .put('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ tipo: 'HEALTH', conceder: true });

      expect(decisao.status).toBe(200);
      expect((decisao.body as Consentimento).concedido).toBe(true);

      const leitura = await request(servidor())
        .get('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`);

      const corpo = leitura.body as CorpoDosConsentimentos;
      const saude = corpo.consentimentos.find((c) => c.tipo === 'HEALTH');

      expect(saude?.concedido).toBe(true);
      expect(saude?.decididoEm).toBeTruthy();
    });

    it('REVOGACAO bloqueia IMEDIATAMENTE, sem estado intermediario (ADR-008)', async () => {
      const acesso = await entrar();

      await request(servidor())
        .put('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ tipo: 'TERMS', conceder: true });

      const revogacao = await request(servidor())
        .put('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ tipo: 'TERMS', conceder: false });

      // A PROPRIA resposta da revogacao ja nega -- nao ha "pedido em analise".
      expect((revogacao.body as Consentimento).concedido).toBe(false);

      const leitura = await request(servidor())
        .get('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`);

      const corpo = leitura.body as CorpoDosConsentimentos;
      expect(corpo.consentimentos.find((c) => c.tipo === 'TERMS')?.concedido).toBe(false);
    });

    it('a decisao anterior NAO e apagada -- vira linha substituida (INV-021)', async () => {
      const acesso = await entrar();

      await request(servidor())
        .put('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ tipo: 'MARKETING', conceder: false });

      await request(servidor())
        .put('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ tipo: 'MARKETING', conceder: true });

      const registros = await db.consentRecord.findMany({
        where: { tenantId, studentId: alunoId, document: { type: 'MARKETING' } },
        orderBy: { occurredAt: 'asc' },
      });

      // Duas linhas: a prova de que houve recusa no periodo continua legivel.
      expect(registros).toHaveLength(2);
      expect(registros[0]?.supersededAt).not.toBeNull();
      expect(registros[1]?.supersededAt).toBeNull();
    });

    it('termo APOSENTADO invalida o aceite, mesmo com a decisao intacta', async () => {
      /*
       * O caso que separa a REGRA PURA de uma leitura crua da coluna.
       *
       * A linha de consentimento continua `ACCEPTED` e sem `supersededAt` --
       * quem olhasse so a decisao diria "concedido". Mas o documento que ela
       * aponta foi aposentado, e `avaliarConsentimento` recusa: o aluno
       * aceitou OUTRO texto, e a academia precisa colher o aceite de novo.
       *
       * Sem este teste, trocar `avaliacao.valido` por
       * `decisao.decision === 'ACCEPTED'` passa verde -- foi o que um canario
       * plantado provou durante a F26.
       */
      const acesso = await entrar(EMAIL_VIZINHO);

      await request(servidor())
        .put('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ tipo: 'HEALTH', conceder: true });

      const antes = await request(servidor())
        .get('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`);

      expect(
        (antes.body as CorpoDosConsentimentos).consentimentos.find((c) => c.tipo === 'HEALTH')
          ?.concedido,
      ).toBe(true);

      await db.consentDocument.updateMany({
        where: { tenantId, type: 'HEALTH' },
        data: { retiredAt: new Date() },
      });

      const depois = await request(servidor())
        .get('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`);

      const saude = (depois.body as CorpoDosConsentimentos).consentimentos.find(
        (c) => c.tipo === 'HEALTH',
      );

      expect(saude?.concedido).toBe(false);
      expect(saude?.motivo).toBe('CONSENT_DOCUMENT_RETIRED');

      // Devolve o termo ao ar: as outras asserções da suite dependem dele.
      await db.consentDocument.updateMany({
        where: { tenantId, type: 'HEALTH' },
        data: { retiredAt: null },
      });
    });

    it('menor de idade nao consegue decidir', async () => {
      const acesso = await entrar(EMAIL_MENOR);

      const resposta = await request(servidor())
        .put('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ tipo: 'HEALTH', conceder: true });

      expect(resposta.status).toBe(404);
      expect((resposta.body as { code?: string }).code).toBe('CONSENT_REQUIRES_LEGAL_GUARDIAN');
    });

    it('tipo fora da lista do app e recusado', async () => {
      const acesso = await entrar();

      const resposta = await request(servidor())
        .put('/api/v1/mobile/consentimentos')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ tipo: 'BIOMETRIC', conceder: true });

      expect(resposta.status).toBe(400);
    });
  });

  describe('Exportacao assincrona do historico', () => {
    it('devolve o job na hora e completa em background', async () => {
      const acesso = await entrar();
      const chave = randomUUID();

      const pedido = await request(servidor())
        .post('/api/v1/mobile/exportacoes')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ idempotencyKey: chave });

      expect(pedido.status).toBe(201);

      const job = pedido.body as CorpoDaExportacao;
      // O pedido NAO espera o arquivo: responde antes de o CSV existir.
      expect(['PENDING', 'RUNNING']).toContain(job.status);

      const pronto = await aguardarConclusao(acesso, job.id);

      expect(pronto.status).toBe('COMPLETED');
      // Duas avaliacoes, uma medida cada -- uma linha POR MEDIDA.
      expect(pronto.rowCount).toBe(2);
    });

    it('mesma `idempotencyKey` devolve o MESMO job, nao dois arquivos', async () => {
      const acesso = await entrar();
      const chave = randomUUID();

      const primeiro = await request(servidor())
        .post('/api/v1/mobile/exportacoes')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ idempotencyKey: chave });

      const segundo = await request(servidor())
        .post('/api/v1/mobile/exportacoes')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ idempotencyKey: chave });

      expect((segundo.body as CorpoDaExportacao).id).toBe((primeiro.body as CorpoDaExportacao).id);
    });

    it('o link so sai depois de COMPLETED', async () => {
      const acesso = await entrar();

      const pedido = await request(servidor())
        .post('/api/v1/mobile/exportacoes')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ idempotencyKey: randomUUID() });

      const job = pedido.body as CorpoDaExportacao;
      await aguardarConclusao(acesso, job.id);

      const download = await request(servidor())
        .post(`/api/v1/mobile/exportacoes/${job.id}/download`)
        .set('Authorization', `Bearer ${acesso}`);

      expect(download.status).toBe(201);
      expect((download.body as { downloadUrl: string }).downloadUrl).toBeTruthy();
    });

    it('aluno NAO consulta a exportacao de outro aluno', async () => {
      const doVizinho = await entrar(EMAIL_VIZINHO);

      const pedido = await request(servidor())
        .post('/api/v1/mobile/exportacoes')
        .set('Authorization', `Bearer ${doVizinho}`)
        .send({ idempotencyKey: randomUUID() });

      const jobDoVizinho = (pedido.body as CorpoDaExportacao).id;

      const intruso = await entrar();
      const resposta = await request(servidor())
        .get(`/api/v1/mobile/exportacoes/${jobDoVizinho}`)
        .set('Authorization', `Bearer ${intruso}`);

      // 404, e nao 403: "existe, mas nao e seu" confirmaria a exportacao
      // alheia.
      expect(resposta.status).toBe(404);
    });
  });

  /**
   * Consulta ate o job sair de `PENDING`/`RUNNING`.
   *
   * Espera ATIVA e nao `setTimeout` fixo: o processamento roda em background
   * disparado pelo pedido, e um tempo fixo ou seria lento demais ou
   * produziria falha intermitente num CI mais carregado que a maquina local.
   */
  const aguardarConclusao = async (acesso: string, jobId: string): Promise<CorpoDaExportacao> => {
    for (let tentativa = 0; tentativa < 40; tentativa += 1) {
      const resposta = await request(servidor())
        .get(`/api/v1/mobile/exportacoes/${jobId}`)
        .set('Authorization', `Bearer ${acesso}`);

      const job = resposta.body as CorpoDaExportacao;

      if (job.status !== 'PENDING' && job.status !== 'RUNNING') return job;

      await new Promise((resolva) => setTimeout(resolva, 100));
    }

    throw new Error(`exportacao ${jobId} nao concluiu a tempo`);
  };
});
