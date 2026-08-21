import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { FakeMalwareScannerAdapter } from '../../src/modules/health/provider/fake-malware-scanner.adapter.js';
import { DOCUMENT_EXTRACTOR } from '../../src/modules/health/provider/document-extractor.port.js';
import { LaudoBioimpedanciaExtractor } from '../../src/modules/health/provider/laudo-bioimpedancia.extractor.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F-multiarquivo (Task 5) -- upload em sessao e confirmacao unica.
 *
 * O que este arquivo prova, e que teste de funcao pura (Tasks 3, 4) NAO
 * alcanca:
 *
 *   - tres arquivos da MESMA sessao viram UMA avaliacao com as medidas de
 *     todos (nao tres avaliacoes, nao uma so com o ultimo arquivo);
 *   - CONFIRMAR DUAS VEZES A MESMA SESSAO NUNCA CRIA DUAS AVALIACOES --
 *     o requisito mais importante da fatia, garantido pelo INDICE PARCIAL
 *     do banco (`assessment_imports_session_assessment_uq`), nao por um
 *     `if` na aplicacao;
 *   - sessao sem bioimpedancia e recusada (`BIOIMPEDANCE_REQUIRED`);
 *   - isolamento entre tenants tambem vale para SESSAO (INV-006);
 *   - o fluxo de UM arquivo (F19) continua identico visto de fora.
 *
 * `DOCUMENT_EXTRACTOR` e sobrescrito para `LaudoBioimpedanciaExtractor`
 * NESTA suite -- ela le os CSVs reais com `faixa_min`/`faixa_max`/
 * `percentual_padrao` e o ECG textual, formato que o dublê de OCR da F19
 * (`FakeOcrExtractorAdapter`) nao entende. F19 continua usando o dublê dela
 * em `upload-e-revisao.int-spec.ts`, sem qualquer alteracao.
 */
describe('F-multiarquivo -- sessao de revisao', () => {
  let app: INestApplication;
  let db: PrismaService;
  let scanner: FakeMalwareScannerAdapter;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: { email: `fma-a-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
    b: { email: `fma-b-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
  };

  const PERMISSOES = ['student.create', 'student.read', 'health.read', 'health.assess'];

  const storageFalso = {
    createPrivateUpload: () =>
      Promise.resolve({ uploadUrl: 'https://storage.test/x', expiresAt: '' }),
    headPrivateObject: () => Promise.resolve({ size: 1, contentType: 'text/csv' }),
    deletePrivateObject: () => Promise.resolve(),
    putPrivateObject: () => Promise.resolve(),
    createPrivateDownload: (entrada: { key: string }) =>
      Promise.resolve({
        downloadUrl: `https://storage.test/${entrada.key}`,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    verificar: () => Promise.resolve(true),
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

  const dirFixtures = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/health');
  const BIO_CSV = readFileSync(join(dirFixtures, 'laudo-cf610g-sintetico.csv'));
  const UNIQUE_CSV = readFileSync(join(dirFixtures, 'laudo-unique-health-sintetico.csv'));

  /**
   * O ECG real chega como PDF (OmronConnect); o fixture `.txt` e o texto JA
   * EXTRAIDO da camada de texto (`pdftotext`, ADR-035 decisao 8) -- exatamente
   * o que `laudo-bioimpedancia.extractor.spec.ts` usa chamando o extrator
   * direto. Mas esta suite sobe pela HTTP de VERDADE, e `aceitarArquivo`
   * confere a ASSINATURA nos primeiros bytes antes de qualquer coisa tocar o
   * extrator -- um `.txt` puro declarado como `application/pdf` levaria
   * `FILE_SIGNATURE_UNKNOWN`. O cabecalho `%PDF-1.7` prefixado aqui satisfaz
   * SO a aceitacao; o extrator decodifica o buffer inteiro como UTF-8 e
   * procura os marcadores por regex (`Frequencia cardiaca:`, `Analise
   * instantanea:`), que continuam presentes depois do prefixo.
   */
  const ECG_PDF = Buffer.concat([
    Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
    readFileSync(join(dirFixtures, 'ecg-omron-sintetico.txt')),
  ]);

  const enviar = async (
    conta: (typeof contas)['a'],
    studentId: string,
    conteudo: Buffer,
    nome: string,
    tipo: string,
    campos: { reviewSessionId?: string; sourceLabel?: string } = {},
  ): Promise<request.Response> => {
    let requisicao = request(servidor())
      .post(`/api/v1/students/${studentId}/assessment-imports`)
      .set('Cookie', conta.cookie);

    for (const [chave, valor] of Object.entries(campos)) {
      requisicao = requisicao.field(chave, valor);
    }

    return requisicao.attach('file', conteudo, { filename: nome, contentType: tipo });
  };

  interface CampoResposta {
    id: string;
    type: string;
    state: string;
  }

  interface LinhaResposta {
    type: string;
    concordante: boolean;
    campos: CampoResposta[];
  }

  interface SessaoResposta {
    sessionId: string;
    arquivos: { importId: string; sourceLabel: string; tipoDeLaudo: string }[];
    linhas: LinhaResposta[];
    podeConfirmar: { pronta: boolean; motivo?: string };
  }

  const detalharSessao = async (
    conta: (typeof contas)['a'],
    sessionId: string,
  ): Promise<request.Response> =>
    request(servidor())
      .get(`/api/v1/assessment-imports/sessions/${sessionId}`)
      .set('Cookie', conta.cookie);

  const revisar = async (
    conta: (typeof contas)['a'],
    importId: string,
    fieldId: string,
    corpo: Record<string, unknown>,
  ): Promise<request.Response> =>
    request(servidor())
      .post(`/api/v1/assessment-imports/${importId}/fields/${fieldId}`)
      .set('Cookie', conta.cookie)
      .send(corpo);

  const confirmarSessao = async (
    conta: (typeof contas)['a'],
    sessionId: string,
    assessedAt = '2026-08-10T12:00:00.000Z',
  ): Promise<request.Response> =>
    request(servidor())
      .post(`/api/v1/assessment-imports/sessions/${sessionId}/confirm`)
      .set('Cookie', conta.cookie)
      .send({ assessedAt });

  /**
   * Confirma TODOS os campos de TODOS os arquivos da sessao com o estado
   * `CONFIRMED` -- o caminho "revisor concorda com tudo que o extrator leu".
   *
   * A resposta da sessao nao diz de qual IMPORT veio cada campo (a rota so
   * expoe o campo em si) -- resolvido aqui consultando o banco DIRETO, sem
   * estado global compartilhado entre testes (a mesma armadilha que ja
   * mordeu este repo: dublê com estado vaza de um bloco para o proximo).
   */
  /**
   * Confirma a sessao como um revisor de VERDADE resolveria -- e nao "clica
   * CONFIRMED em tudo que estiver PENDING".
   *
   * Fix round 2 (achado ao rodar contra Postgres real): uma linha
   * DIVERGENTE (`concordante: false`, mais de um campo -- ex.: `HEART_RATE`
   * 84 do Unique Health contra 92 do ECG) exige que o revisor ESCOLHA UM
   * lado. Confirmar os DOIS lados nao e "resolver a divergencia mais
   * rapido" -- e o mesmo erro que um usuario real nunca cometeria, porque a
   * tela so oferece "qual dos dois esta certo", nunca "os dois". Confirmar
   * ambos produzia duas medidas do MESMO tipo na mesma avaliacao, e o
   * `@@unique([assessmentId, type])` do banco estourava um erro cru na
   * confirmacao -- sintoma correto de um teste que simulava um usuario que
   * nao existe.
   */
  const confirmarTodosOsCampos = async (
    conta: (typeof contas)['a'],
    sessionId: string,
  ): Promise<SessaoResposta> => {
    const antes = (await detalharSessao(conta, sessionId)).body as SessaoResposta;

    for (const linha of antes.linhas) {
      const divergente = !linha.concordante && linha.campos.length > 1;
      const pendentes = linha.campos.filter((campo) => campo.state === 'PENDING');

      for (const [indice, campo] of pendentes.entries()) {
        const linhaDoCampo = await db.importedField.findUniqueOrThrow({
          where: { id: campo.id },
          select: { importId: true },
        });

        // Numa linha divergente, so o PRIMEIRO candidato pendente e
        // confirmado; os outros sao descartados -- exatamente a escolha
        // que `sessaoPodeConfirmar` exige do revisor.
        const decisao = divergente && indice > 0 ? 'DISCARDED' : 'CONFIRMED';

        await revisar(conta, linhaDoCampo.importId, campo.id, { state: decisao });
      }
    }

    return (await detalharSessao(conta, sessionId)).body as SessaoResposta;
  };

  /** Envia os tres arquivos sinteticos (bio + unique + ECG) na MESMA sessao. */
  const prepararSessaoCompleta = async (
    conta: (typeof contas)['a'] = contas.a,
  ): Promise<{ studentId: string; reviewSessionId: string }> => {
    const studentId = await criarAluno(conta);

    const envioBio = await enviar(conta, studentId, BIO_CSV, 'cf610g.csv', 'text/csv', {
      sourceLabel: 'CF610_G',
    });
    expect(envioBio.status).toBe(201);
    const reviewSessionId = (envioBio.body as { reviewSessionId: string }).reviewSessionId;

    const envioUnique = await enviar(conta, studentId, UNIQUE_CSV, 'unique.csv', 'text/csv', {
      reviewSessionId,
      sourceLabel: 'Unique Health',
    });
    expect(envioUnique.status).toBe(201);

    const envioEcg = await enviar(conta, studentId, ECG_PDF, 'ecg.pdf', 'application/pdf', {
      reviewSessionId,
      sourceLabel: 'ECG 30s',
    });
    expect(envioEcg.status).toBe(201);

    return { studentId, reviewSessionId };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storageFalso)
      .overrideProvider(DOCUMENT_EXTRACTOR)
      .useClass(LaudoBioimpedanciaExtractor)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    scanner = app.get(FakeMalwareScannerAdapter);

    await montarAcademia(contas.a, `fma-academia-a-${sufixo}`);
    await montarAcademia(contas.b, `fma-academia-b-${sufixo}`);
  });

  afterEach(() => {
    scanner.resetar();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('tres arquivos, uma avaliacao', () => {
    it('tres arquivos viram UMA avaliacao com as medidas de todos', async () => {
      const { studentId, reviewSessionId } = await prepararSessaoCompleta();

      await confirmarTodosOsCampos(contas.a, reviewSessionId);
      const resposta = await confirmarSessao(contas.a, reviewSessionId);

      expect(resposta.status).toBe(201);
      const { assessmentId } = resposta.body as { assessmentId: string };

      const avaliacoes = await db.bodyAssessment.findMany({ where: { studentId } });
      expect(avaliacoes).toHaveLength(1);

      const imports = await db.assessmentImport.findMany({ where: { assessmentId } });
      expect(imports).toHaveLength(3);

      const medidas = await db.bodyMeasurement.findMany({ where: { assessmentId } });
      // WEIGHT aparece nos dois CSVs (88.40 e 88.4 -- concorda dentro da
      // tolerancia) e deve virar UMA medida so, nao duas.
      const pesos = medidas.filter((m) => m.type === 'WEIGHT');
      expect(pesos).toHaveLength(1);

      // Campos exclusivos de cada arquivo tambem entraram.
      const tipos = medidas.map((m) => m.type);
      expect(tipos).toContain('SKELETAL_MUSCLE_MASS'); // so no CF610_G
      expect(tipos).toContain('BONE_MASS'); // so no Unique Health
    });

    /**
     * FIX Critical 3 (revisao adversarial) -- campo PENDING sozinho (numa
     * linha CONCORDANTE, nao divergente) passava batido pela porta de
     * `sessaoPodeConfirmar` -- ela so bloqueia PENDING em linha DIVERGENTE
     * com mais de um campo. `valoresAceitos` pula estado PENDING em
     * silencio, entao a confirmacao seguia sem a medida -- e o arquivo e
     * apagado logo depois, tornando o valor IRRECUPERAVEL. `confirmar`
     * (import isolado, F19) ja fechava esta porta com `revisaoCompleta`;
     * este teste prova que `confirmarSessao` fecha a MESMA porta agora.
     */
    it('campo PENDING sozinho (so um arquivo mediu) impede a confirmacao da sessao', async () => {
      const studentId = await criarAluno(contas.a);

      const envioBio = await enviar(contas.a, studentId, BIO_CSV, 'cf610g.csv', 'text/csv', {
        sourceLabel: 'CF610_G',
      });
      expect(envioBio.status).toBe(201);
      const reviewSessionId = (envioBio.body as { reviewSessionId: string }).reviewSessionId;

      // `BONE_MASS` so existe no Unique Health -- nao ha divergencia (nao
      // ha outro campo do mesmo tipo para comparar), so ausencia de decisao.
      const envioUnique = await enviar(contas.a, studentId, UNIQUE_CSV, 'unique.csv', 'text/csv', {
        reviewSessionId,
        sourceLabel: 'Unique Health',
      });
      expect(envioUnique.status).toBe(201);

      const antes = await detalharSessao(contas.a, reviewSessionId);
      const linhas = (antes.body as SessaoResposta).linhas;

      // Confirma TUDO exceto BONE_MASS -- que fica PENDING de proposito.
      for (const linha of linhas) {
        if (linha.type === 'BONE_MASS') continue;

        for (const campo of linha.campos) {
          if (campo.state !== 'PENDING') continue;

          const linhaDoCampo = await db.importedField.findUniqueOrThrow({
            where: { id: campo.id },
            select: { importId: true },
          });

          await revisar(contas.a, linhaDoCampo.importId, campo.id, { state: 'CONFIRMED' });
        }
      }

      const resposta = await confirmarSessao(contas.a, reviewSessionId);

      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('IMPORT_HAS_PENDING_FIELDS');

      // Nenhuma avaliacao nasceu, e o arquivo NAO foi apagado -- o valor
      // pendente continua recuperavel.
      const avaliacoes = await db.bodyAssessment.count({ where: { studentId } });
      expect(avaliacoes).toBe(0);

      const importsComArquivo = await db.assessmentImport.findMany({
        where: { reviewSessionId },
        select: { objectKey: true },
      });
      expect(importsComArquivo.every((i) => i.objectKey !== null)).toBe(true);
    });

    /**
     * O teste MAIS IMPORTANTE da fatia -- e o unico que prova concorrencia de
     * verdade, nao serializacao acidental (as duas chamadas disparam ANTES
     * de qualquer `await` resolver, via `Promise.allSettled` sobre as duas
     * promises ja criadas).
     *
     * FIX Important 5 (revisao adversarial): a asserção original so contava
     * `bodyAssessment.findMany({ where: { studentId } })` sem filtrar por
     * status -- antes do fix do Critical 2, a PERDEDORA da corrida publicava
     * a propria avaliacao (orfa, sem import apontando pra ela) e a contagem
     * batia 2, fazendo o teste falhar CORRETAMENTE. Depois do fix, a
     * perdedora nunca publica (o rascunho dela e apagado no `catch`), entao
     * a asserção de contagem passaria mesmo se o reordenamento estivesse
     * incompleto e deixasse um DRAFT orfao para tras -- a contagem simples
     * nao pegaria isso. As asserções abaixo fecham essa lacuna: contam
     * PUBLICADAS e RASCUNHOS separadamente, e conferem que a UNICA avaliacao
     * publicada e exatamente a que a resposta 201 devolveu.
     */
    it('confirmar duas vezes NAO cria duas avaliacoes', async () => {
      const { studentId, reviewSessionId } = await prepararSessaoCompleta();
      await confirmarTodosOsCampos(contas.a, reviewSessionId);

      const [a, b] = await Promise.allSettled([
        confirmarSessao(contas.a, reviewSessionId),
        confirmarSessao(contas.a, reviewSessionId),
      ]);

      // As DUAS chamadas HTTP respondem (uma 201, uma 409) -- `allSettled`
      // nunca rejeita a promise do supertest; quem falha e o STATUS.
      const sucessos = [a, b].filter(
        (r) => r.status === 'fulfilled' && r.value.status === 201,
      );
      expect(sucessos).toHaveLength(1);

      const conflitos = [a, b].filter(
        (r) => r.status === 'fulfilled' && r.value.status === 409,
      );
      expect(conflitos).toHaveLength(1);

      const vencedora = sucessos[0];
      if (vencedora === undefined || vencedora.status !== 'fulfilled') {
        throw new Error('vencedora nao cumpriu');
      }
      const assessmentIdVencedor = (vencedora.value.body as { assessmentId: string }).assessmentId;

      // Nenhuma avaliacao PUBLICADA alem da vencedora -- se a perdedora
      // tivesse publicado a propria (Critical 2, corrigido), apareceria aqui.
      const publicadas = await db.bodyAssessment.findMany({
        where: { studentId, status: 'PUBLISHED' },
      });
      expect(publicadas).toHaveLength(1);
      expect(publicadas[0]?.id).toBe(assessmentIdVencedor);

      // Nenhum RASCUNHO orfao para tras -- se a limpeza do `catch` nao
      // rodasse, o rascunho da perdedora ficaria aqui, visivel em
      // `listarDoAluno` (F19/F17), que lista TODOS os status.
      const rascunhos = await db.bodyAssessment.findMany({
        where: { studentId, status: 'DRAFT' },
      });
      expect(rascunhos).toHaveLength(0);

      // TODOS os tres imports da sessao apontam para a MESMA avaliacao
      // vencedora -- nao ha import "perdido" apontando para o rascunho
      // apagado da perdedora.
      const imports = await db.assessmentImport.findMany({ where: { reviewSessionId } });
      expect(imports).toHaveLength(3);
      expect(imports.every((i) => i.assessmentId === assessmentIdVencedor)).toBe(true);
    });
  });

  describe('sessaoPodeConfirmar (Task 4) na porta da frente', () => {
    /**
     * Fix round 2: `UNIQUE_CSV` NAO serve mais para este teste -- ele MEDE
     * composicao corporal (massa ossea, massa celular, percentual de
     * gordura, relacao cintura-quadril), entao classifica como
     * `BIOIMPEDANCE` (o classificador foi corrigido, fora desta fatia, para
     * aceitar QUALQUER medida de composicao corporal, nao so segmentar --
     * `laudo-bioimpedancia.extractor.ts`, `temComposicaoCorporal`). O UNICO
     * arquivo genuinamente sem bioimpedancia no conjunto de fixtures e o
     * ECG, que so produz `HEART_RATE`.
     */
    it('recusa sessao sem bioimpedancia', async () => {
      const studentId = await criarAluno(contas.a);

      const envio = await enviar(contas.a, studentId, ECG_PDF, 'so-ecg.pdf', 'application/pdf', {
        sourceLabel: 'ECG 30s',
      });
      const reviewSessionId = (envio.body as { reviewSessionId: string }).reviewSessionId;

      await confirmarTodosOsCampos(contas.a, reviewSessionId);

      const resposta = await confirmarSessao(contas.a, reviewSessionId);

      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('BIOIMPEDANCE_REQUIRED');

      const avaliacoes = await db.bodyAssessment.count({ where: { studentId } });
      expect(avaliacoes).toBe(0);
    });

    it('recusa sessao vazia', async () => {
      // Sessao que nunca recebeu upload: id aleatorio, nunca gravado.
      const resposta = await confirmarSessao(contas.a, randomUUID());

      expect(resposta.status).toBe(404);
    });
  });

  /**
   * FIX Critical 1 (revisao adversarial) -- corrupcao de dado de saude ENTRE
   * PACIENTES, dentro do MESMO tenant.
   *
   * `reviewSessionId` chega no CORPO do pedido e, antes do fix, era gravado
   * as cegas por `criar` -- nada conferia que a sessao pertencia ao MESMO
   * aluno do upload. Um upload para o aluno B carregando o `reviewSessionId`
   * do aluno A anexava o arquivo de B a sessao de A; `encontrarSessao` deriva
   * `studentId` da PRIMEIRA linha da sessao, entao a confirmacao gravaria a
   * MEDIDA DE B na ficha de A -- pior que vazamento de tenant, e o tipo de
   * corrupcao que a arquitetura de isolamento nem sempre cobre (o `tenantId`
   * bate; e o `studentId` DENTRO do tenant que nao tinha guarda nenhuma).
   */
  describe('reviewSessionId de outro aluno (corrupcao entre pacientes)', () => {
    it('upload para o aluno B com a sessao do aluno A e recusado', async () => {
      const alunoA = await criarAluno(contas.a);
      const alunoB = await criarAluno(contas.a);

      const envioA = await enviar(contas.a, alunoA, BIO_CSV, 'a.csv', 'text/csv', {
        sourceLabel: 'CF610_G',
      });
      expect(envioA.status).toBe(201);
      const sessaoDeA = (envioA.body as { reviewSessionId: string }).reviewSessionId;

      // Ataque: upload para B carregando o reviewSessionId de A.
      const envioB = await enviar(contas.a, alunoB, UNIQUE_CSV, 'b.csv', 'text/csv', {
        reviewSessionId: sessaoDeA,
        sourceLabel: 'Unique Health',
      });

      expect(envioB.status).toBe(409);
      expect((envioB.body as { code: string }).code).toBe('SESSION_STUDENT_MISMATCH');

      // A sessao de A continua com UM arquivo so -- o de B nunca entrou.
      const imports = await db.assessmentImport.findMany({
        where: { reviewSessionId: sessaoDeA },
      });
      expect(imports).toHaveLength(1);
      expect(imports[0]?.studentId).toBe(alunoA);

      // Confirmando a sessao de A, a medida de B NUNCA aparece na ficha dele.
      await confirmarTodosOsCampos(contas.a, sessaoDeA);
      const confirmacao = await confirmarSessao(contas.a, sessaoDeA);
      expect(confirmacao.status).toBe(201);

      const avaliacoesDeA = await db.bodyAssessment.count({ where: { studentId: alunoA } });
      expect(avaliacoesDeA).toBe(1);
      const avaliacoesDeB = await db.bodyAssessment.count({ where: { studentId: alunoB } });
      expect(avaliacoesDeB).toBe(0);
    });
  });

  describe('isolamento entre tenants (INV-006)', () => {
    it('a academia B nao le sessao da academia A', async () => {
      const { reviewSessionId } = await prepararSessaoCompleta();

      const resposta = await detalharSessao(contas.b, reviewSessionId);

      expect(resposta.status).toBe(404);
    });

    it('a academia B nao confirma sessao da academia A', async () => {
      const { reviewSessionId } = await prepararSessaoCompleta();
      await confirmarTodosOsCampos(contas.a, reviewSessionId);

      const resposta = await confirmarSessao(contas.b, reviewSessionId);

      expect(resposta.status).toBe(404);
    });
  });

  describe('compatibilidade com o fluxo de UM arquivo (F19)', () => {
    it('upload sem reviewSessionId no corpo gera uma sessao nova', async () => {
      const studentId = await criarAluno(contas.a);

      const resposta = await enviar(contas.a, studentId, BIO_CSV, 'sozinho.csv', 'text/csv');

      expect(resposta.status).toBe(201);
      expect((resposta.body as { reviewSessionId: string }).reviewSessionId).toBeTruthy();
    });

    it('sessao de UM arquivo com bioimpedancia confirma sozinha, sem exigir ECG', async () => {
      const studentId = await criarAluno(contas.a);

      const envio = await enviar(contas.a, studentId, BIO_CSV, 'sozinho.csv', 'text/csv', {
        sourceLabel: 'CF610_G',
      });
      const reviewSessionId = (envio.body as { reviewSessionId: string }).reviewSessionId;

      await confirmarTodosOsCampos(contas.a, reviewSessionId);
      const resposta = await confirmarSessao(contas.a, reviewSessionId);

      expect(resposta.status).toBe(201);

      const avaliacoes = await db.bodyAssessment.count({ where: { studentId } });
      expect(avaliacoes).toBe(1);
    });

    /**
     * A ROTA ANTIGA da F19 (`POST .../:id/confirm`, sem sessao no path)
     * continua respondendo -- e sem a porta de `sessaoPodeConfirmar`: uma
     * importacao avulsa de peso/gordura, sem bioimpedancia classificada, tem
     * de confirmar exatamente como confirmava antes desta fatia. Se
     * `confirmar` delegasse cegamente para `confirmarSessao` so por a
     * importacao ter `reviewSessionId` (toda importacao tem, desde a Task
     * 5), esta CSV generica levaria `BIOIMPEDANCE_REQUIRED` -- regressao
     * que este teste existe para pegar.
     */
    it('a rota antiga (import isolado) nao exige bioimpedancia', async () => {
      const studentId = await criarAluno(contas.a);

      const envio = await enviar(contas.a, studentId, UNIQUE_CSV, 'generico.csv', 'text/csv');
      const importId = (envio.body as { id: string }).id;

      const detalhe = await request(servidor())
        .get(`/api/v1/assessment-imports/${importId}`)
        .set('Cookie', contas.a.cookie);

      for (const campo of (detalhe.body as { fields: { id: string }[] }).fields) {
        await revisar(contas.a, importId, campo.id, { state: 'CONFIRMED' });
      }

      const resposta = await request(servidor())
        .post(`/api/v1/assessment-imports/${importId}/confirm`)
        .set('Cookie', contas.a.cookie)
        .send({ assessedAt: '2026-08-10T12:00:00.000Z' });

      expect(resposta.status).toBe(201);

      const avaliacoes = await db.bodyAssessment.count({ where: { studentId } });
      expect(avaliacoes).toBe(1);
    });
  });
});
