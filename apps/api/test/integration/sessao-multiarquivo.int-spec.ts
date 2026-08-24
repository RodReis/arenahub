import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { Prisma } from '@arenahub/database';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { AssessmentRepository } from '../../src/modules/health/assessment.repository.js';
import { AvaliacaoJaExisteParaOrigemError } from '../../src/modules/health/domain/avaliacao.js';
import { FakeMalwareScannerAdapter } from '../../src/modules/health/provider/fake-malware-scanner.adapter.js';
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
 * Nao ha override de `DOCUMENT_EXTRACTOR` aqui: em producao o roteador
 * (`DocumentExtractorRouterAdapter`) ja manda CSV e PDF -- os dois tipos que
 * esta suite usa -- para `LaudoBioimpedanciaExtractor`, entao a suite exercita
 * o wiring real. F19 (`upload-e-revisao.int-spec.ts`) sobrescreve para
 * `FakeOcrExtractorAdapter`: o fixture PDF dela e generico (so a assinatura
 * de bytes), o caso que o dublê de OCR ainda cobre em producao.
 */
describe('F-multiarquivo -- sessao de revisao', () => {
  let app: INestApplication;
  let db: PrismaService;
  let scanner: FakeMalwareScannerAdapter;
  let avaliacoesRepo: AssessmentRepository;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: { email: `fma-a-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
    b: { email: `fma-b-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
  };

  const PERMISSOES = ['student.create', 'student.read', 'health.read', 'health.assess', 'health.upload'];

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
        // Obrigatorio desde o ADR-043 Decisao 3; este arquivo nao testa CPF,
        // entao um valor fixo e valido basta.
        cpf: '52998224725',
        contacts: [],
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  const dirFixtures = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/health');
  const BIO_CSV = readFileSync(join(dirFixtures, 'laudo-cf610g-sintetico.csv'));
  const UNIQUE_CSV = readFileSync(join(dirFixtures, 'laudo-unique-health-sintetico.csv'));

  /**
   * PDF DE VERDADE, com camada de texto -- como o OmronConnect exporta.
   *
   * Era um `.txt` com o cabecalho `%PDF-1.7` colado na frente, so para
   * satisfazer a checagem de assinatura de `aceitarArquivo`. Funcionava
   * porque o extrator decodificava o buffer inteiro como UTF-8: um `.txt`
   * disfarcado passava, e um PDF de verdade NAO -- que e exatamente o
   * contrario do que a suite deveria provar, e o motivo de o ECG real falhar
   * em producao com `EXTRACTOR_NO_CONTENT`.
   *
   * Com `unpdf` lendo a camada de texto, o fixture passa a ser o arquivo que
   * o aparelho produz.
   */
  const ECG_PDF = readFileSync(join(dirFixtures, 'ecg-omron-sintetico.pdf'));

  const enviar = async (
    conta: (typeof contas)['a'],
    studentId: string,
    conteudo: Buffer,
    nome: string,
    tipo: string,
    campos: { reviewSessionId?: string; sourceLabel?: string; ultimoDaSessao?: string } = {},
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
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    scanner = app.get(FakeMalwareScannerAdapter);
    avaliacoesRepo = app.get(AssessmentRepository);

    await montarAcademia(contas.a, `fma-academia-a-${sufixo}`);
    await montarAcademia(contas.b, `fma-academia-b-${sufixo}`);
  });

  afterEach(() => {
    scanner.resetar();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * BUG CORRIGIDO (era reportado como bug antes desta entrega, agora
   * fechado em `import.service.ts`): ADR-039 fazia `enviar` chamar
   * `publicarAutomaticamente` -> `confirmar` apos CADA arquivo, nao so o
   * ultimo da sessao -- o segundo arquivo de uma sessao de tres ja
   * confirmava a SESSAO INTEIRA sozinho, antes do terceiro chegar e antes
   * de QUALQUER revisao humana. Produzia 1 avaliacao publicada incompleta,
   * 1 rascunho orfao e 1 arquivo perdido em `EXTRACTED`.
   *
   * A correcao: `enviar` so publica quando o CHAMADOR marca
   * `ultimoDaSessao: 'true'` no upload -- ausente ou falso, a importacao
   * fica `EXTRACTED` (visivel na fila F22, revisavel a mao). Os testes deste
   * bloco NAO marcam nenhum upload como ultimo -- exercitam o caminho MANUAL
   * (revisar campo a campo, confirmar a sessao explicitamente pela rota).
   * O caminho AUTOMATICO (ultimo arquivo marcado, publica sozinho com dados
   * de TODOS os arquivos) esta provado em 'ultimoDaSessao pina o bug da
   * cascata' logo abaixo.
   */
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

    /**
     * FIX (revisao adversarial, achado contra Postgres real): "sessao
     * permanentemente travada, com erro que mente sobre a causa".
     *
     * `consolidar()` colapsa a linha CONCORDANTE de `WEIGHT` (88,40 do
     * CF610_G e 88,4 do Unique Health concordam dentro da tolerancia) para
     * UM representante -- o gemeo NUNCA aparece em `linha.campos`, entao a
     * tela de revisao normal nunca oferece um botao para confirma-lo. Mas a
     * rota de campo isolado da F19 (`POST .../fields/:fieldId`, mesma
     * permissao `health.assess`) aceita QUALQUER campo do import, sem saber
     * que ele e um gemeo escondido -- e nada a protegia.
     *
     * Reproduz exatamente a sequencia do achado:
     *   1. sobe CF610_G + Unique Health na mesma sessao (WEIGHT concorda,
     *      colapsa para um representante);
     *   2. revisa normalmente -- todo campo VISIVEL confirmado;
     *   3. confirma o gemeo escondido pela rota de campo isolado (F19);
     *   4. confirma a sessao.
     *
     * Antes do fix: passo 4 falhava com 409 `SESSION_ALREADY_CONFIRMED`
     * (mentindo sobre a causa -- o problema era medida duplicada, nao
     * confirmacao dupla) e a sessao ficava travada PARA SEMPRE, porque
     * nenhuma tentativa futura resolve um conflito que esta nos DADOS.
     *
     * Depois do fix: `valoresAceitosDaSessao` roda `valoresAceitos` POR
     * LINHA consolidada -- a linha `WEIGHT` so tem o representante em
     * `linha.campos`, entao o gemeo confirmado por fora NUNCA e visto por
     * esta chamada. A sessao confirma normalmente, com UMA medida `WEIGHT`
     * so.
     */
    it('confirmar o gemeo escondido pela rota de campo isolado (F19) nao trava a sessao', async () => {
      const studentId = await criarAluno(contas.a);

      const envioBio = await enviar(contas.a, studentId, BIO_CSV, 'cf610g.csv', 'text/csv', {
        sourceLabel: 'CF610_G',
      });
      expect(envioBio.status).toBe(201);
      const reviewSessionId = (envioBio.body as { reviewSessionId: string }).reviewSessionId;

      const envioUnique = await enviar(contas.a, studentId, UNIQUE_CSV, 'unique.csv', 'text/csv', {
        reviewSessionId,
        sourceLabel: 'Unique Health',
      });
      expect(envioUnique.status).toBe(201);

      // Passo 2: revisao normal -- todo campo VISIVEL confirmado. A tela
      // NUNCA mostra o gemeo de WEIGHT que concordou e foi colapsado.
      const depoisDaRevisaoNormal = await confirmarTodosOsCampos(contas.a, reviewSessionId);
      const linhaWeight = depoisDaRevisaoNormal.linhas.find((l) => l.type === 'WEIGHT');
      expect(linhaWeight?.campos).toHaveLength(1); // so o representante, o gemeo esta escondido.

      // Passo 3: acha o gemeo ESCONDIDO direto no banco (a API nunca o
      // expõe) e confirma pela rota de campo isolado da F19 -- exatamente
      // o caminho que o achado da revisao adversarial usou.
      const camposWeightNoBanco = await db.importedField.findMany({
        where: {
          type: 'WEIGHT',
          import: { reviewSessionId },
        },
        select: { id: true, importId: true, state: true },
      });
      expect(camposWeightNoBanco).toHaveLength(2); // representante + gemeo.

      const gemeoEscondido = camposWeightNoBanco.find((c) => c.state === 'PENDING');
      expect(gemeoEscondido).toBeDefined();

      const confirmacaoDoGemeo = await revisar(
        contas.a,
        gemeoEscondido!.importId,
        gemeoEscondido!.id,
        { state: 'CONFIRMED' },
      );
      expect(confirmacaoDoGemeo.status).toBe(201);

      // Passo 4: confirma a sessao -- DEVE suceder, nao travar.
      const resposta = await confirmarSessao(contas.a, reviewSessionId);

      expect(resposta.status).toBe(201);
      const { assessmentId } = resposta.body as { assessmentId: string };

      const medidas = await db.bodyMeasurement.findMany({ where: { assessmentId } });
      const pesos = medidas.filter((m) => m.type === 'WEIGHT');
      expect(pesos).toHaveLength(1); // UMA medida, nao duas -- P2002 nao escapou.

      const avaliacoes = await db.bodyAssessment.count({ where: { studentId } });
      expect(avaliacoes).toBe(1);
    });
  });

  /**
   * PINA O BUG DA CASCATA (ver comentario acima de `describe('tres
   * arquivos, uma avaliacao')`) -- nao pode voltar.
   *
   * Duas academias enviam dois arquivos da MESMA sessao; so o SEGUNDO e
   * marcado `ultimoDaSessao: 'true'`. Antes da correcao, o SEGUNDO arquivo
   * via a sessao com `importIds.length > 1` e delegava para
   * `confirmarSessao` incondicionalmente -- e o PRIMEIRO arquivo ja tinha
   * publicado SOZINHO (rota antiga, sem consolidacao) no proprio upload
   * dele. Resultado: 1 avaliacao publicada so com os dados do primeiro
   * arquivo, mais uma segunda tentativa (do segundo arquivo) que nascia
   * ORFA em DRAFT. A correcao gateia a publicacao por `ultimoDaSessao`, e
   * so o UPLOAD MARCADO chama `confirmar`/`confirmarSessao` -- o primeiro
   * arquivo fica `EXTRACTED` esperando o segundo.
   */
  describe('ultimoDaSessao pina o bug da cascata', () => {
    it('so o arquivo marcado como ultimo publica, com os dados dos DOIS arquivos', async () => {
      const studentId = await criarAluno(contas.a);

      const envioBio = await enviar(contas.a, studentId, BIO_CSV, 'cf610g.csv', 'text/csv', {
        sourceLabel: 'CF610_G',
      });
      expect(envioBio.status).toBe(201);
      // Sem `ultimoDaSessao`: o primeiro arquivo NAO publica sozinho.
      expect(envioBio.body).toMatchObject({ status: 'EXTRACTED' });
      const reviewSessionId = (envioBio.body as { reviewSessionId: string }).reviewSessionId;

      const envioUnique = await enviar(contas.a, studentId, UNIQUE_CSV, 'unique.csv', 'text/csv', {
        reviewSessionId,
        sourceLabel: 'Unique Health',
        ultimoDaSessao: 'true',
      });
      expect(envioUnique.status).toBe(201);

      // Nenhum campo foi revisado a mao -- a publicacao automatica no
      // segundo upload marca tudo CONFIRMED/DISCARDED e confirma sozinha,
      // exatamente como no caminho de UM arquivo.
      const avaliacoes = await db.bodyAssessment.findMany({ where: { studentId } });
      expect(avaliacoes).toHaveLength(1);
      expect(avaliacoes[0]?.status).toBe('PUBLISHED');

      const assessmentId = avaliacoes[0]!.id;

      const imports = await db.assessmentImport.findMany({ where: { assessmentId } });
      expect(imports).toHaveLength(2);

      const medidas = await db.bodyMeasurement.findMany({ where: { assessmentId } });
      const tipos = medidas.map((m) => m.type);

      // Dados dos DOIS arquivos, nao so do primeiro (o bug produzia uma
      // avaliacao com so os campos do CF610_G).
      expect(tipos).toContain('SKELETAL_MUSCLE_MASS'); // so no CF610_G
      expect(tipos).toContain('BONE_MASS'); // so no Unique Health

      // WEIGHT concorda entre os dois arquivos e deve virar UMA medida so.
      const pesos = medidas.filter((m) => m.type === 'WEIGHT');
      expect(pesos).toHaveLength(1);

      // Nenhum rascunho orfao para tras -- a assinatura do bug original.
      const rascunhos = await db.bodyAssessment.findMany({
        where: { studentId, status: 'DRAFT' },
      });
      expect(rascunhos).toHaveLength(0);
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
    /**
     * NAO ADAPTADO -- REPORTADO COMO BUG, nao reescrito para aceitar o
     * comportamento novo.
     *
     * Antes de ADR-039, um upload SOZINHO (sessao de 1 arquivo) ficava
     * `EXTRACTED` ate um humano chamar EXPLICITAMENTE a rota de SESSAO
     * (`POST .../sessions/:id/confirm`), que e onde `sessaoPodeConfirmar`
     * (Task 4) exige bioimpedancia. Agora `enviar` chama `confirmar` (nao
     * `confirmarSessao`) automaticamente sempre que a sessao tem UM import
     * -- e `confirmar` (rota antiga, import isolado) NUNCA passou pela
     * porta de `sessaoPodeConfirmar` (e o comportamento documentado em
     * 'a rota antiga nao exige bioimpedancia' abaixo, deliberado desde a
     * Task 5). Um upload SOLITARIO de ECG (so `HEART_RATE`, sem nenhuma
     * medida de composicao corporal) agora publica sozinho como avaliacao
     * valida assim que chega -- a MESMA garantia que motivou este teste
     * (`BIOIMPEDANCE_REQUIRED`) nunca mais dispara para uma sessao de UM
     * arquivo, porque a rota que a aplicava (`confirmarSessao`) deixou de
     * ser alcancada antes do auto-publish reivindicar o import primeiro.
     *
     * Isto NAO estava no escopo do ADR-039 (que fala so do OCR/revisao
     * campo a campo) e nao e revogacao de `sessaoPodeConfirmar` -- e uma
     * interacao nao prevista entre a fatia nova e a Task 5. Reportado no PR;
     * nao corrigido aqui (fora do escopo desta tarefa, e `import.service.ts`
     * esta fora dos arquivos que esta entrega pode tocar).
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
        ultimoDaSessao: 'true',
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

      // ADR-039: o upload de A e sessao de UM arquivo so, entao ja publicou
      // SOZINHO no proprio `enviar` -- antes mesmo da tentativa de ataque
      // acontecer. A medida de B NUNCA aparece na ficha dele, e a sessao de
      // A ja tem a UNICA avaliacao dela.
      const linhaDeA = await db.assessmentImport.findFirstOrThrow({
        where: { reviewSessionId: sessaoDeA },
      });
      expect(linhaDeA.status).toBe('CONFIRMED');

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

    /**
     * ADR-039 + fix do bug de cascata: o upload so publica sozinho quando o
     * CHAMADOR marca `ultimoDaSessao: 'true'` -- sem a flag, a importacao
     * fica `EXTRACTED` (mais seguro, revisavel a mao). Aqui a sessao tem UM
     * arquivo so e ele E o ultimo, entao a flag e exatamente o que o
     * admin-web manda no arquivo final do lote. A publicacao acontece pela
     * rota antiga de import isolado (`confirmar`, nao `confirmarSessao`) --
     * que nunca exigiu bioimpedancia (ver o teste seguinte). Chamar a rota
     * de SESSAO depois disso e redundante: a sessao ja esta confirmada, e a
     * chamada responde 409, nao 201. A garantia que o titulo descreve (uma
     * sessao de UM arquivo com bioimpedancia vira UMA avaliacao, sem exigir
     * ECG) continua valendo -- so o MOMENTO mudou, de "depois que um humano
     * chama confirm" para "no proprio upload, quando marcado como ultimo".
     */
    it('sessao de UM arquivo com bioimpedancia confirma sozinha, sem exigir ECG', async () => {
      const studentId = await criarAluno(contas.a);

      const envio = await enviar(contas.a, studentId, BIO_CSV, 'sozinho.csv', 'text/csv', {
        sourceLabel: 'CF610_G',
        ultimoDaSessao: 'true',
      });

      expect(envio.body).toMatchObject({ status: 'CONFIRMED' });
      const reviewSessionId = (envio.body as { reviewSessionId: string }).reviewSessionId;

      const avaliacoes = await db.bodyAssessment.count({ where: { studentId } });
      expect(avaliacoes).toBe(1);

      // A rota de sessao, chamada depois, so confirma o que ja aconteceu --
      // idempotente, nao um segundo caminho de publicacao.
      const resposta = await confirmarSessao(contas.a, reviewSessionId);
      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('SESSION_ALREADY_CONFIRMED');
    });

    /**
     * A ROTA ANTIGA da F19 (`POST .../:id/confirm`, sem sessao no path)
     * continua respondendo -- e sem a porta de `sessaoPodeConfirmar`: uma
     * importacao avulsa de peso/gordura, sem bioimpedancia classificada,
     * confirma exatamente como confirmava antes desta fatia. Se `confirmar`
     * delegasse cegamente para `confirmarSessao` so por a importacao ter
     * `reviewSessionId` (toda importacao tem, desde a Task 5), esta CSV
     * generica levaria `BIOIMPEDANCE_REQUIRED` -- regressao que este teste
     * existe para pegar.
     *
     * Depois de ADR-039, a rota chega a rodar SOZINHA no proprio upload
     * (`enviar` -> `publicarAutomaticamente` -> `confirmar`) quando marcado
     * como o ultimo arquivo da sessao -- nao precisa mais de uma chamada
     * humana explicita para provar a ausencia da exigencia de bioimpedancia.
     */
    it('a rota antiga (import isolado) nao exige bioimpedancia', async () => {
      const studentId = await criarAluno(contas.a);

      const envio = await enviar(contas.a, studentId, UNIQUE_CSV, 'generico.csv', 'text/csv', {
        ultimoDaSessao: 'true',
      });

      expect(envio.status).toBe(201);
      expect(envio.body).toMatchObject({ status: 'CONFIRMED' });

      const avaliacoes = await db.bodyAssessment.count({ where: { studentId } });
      expect(avaliacoes).toBe(1);
    });
  });

  /**
   * FIX (revisao adversarial, parte b) -- `AssessmentRepository.criarRascunho`
   * so pode traduzir P2002 para `AvaliacaoJaExisteParaOrigemError` quando o
   * indice violado e `body_assessments_import_source_reference_uq`. A MESMA
   * transacao tambem grava `body_measurements`, que tem seu PROPRIO
   * `@@unique([assessmentId, type])` -- e um catch cego que traduzisse
   * QUALQUER P2002 para "sessao ja confirmada" faria essa causa
   * DESAPARECER atras de uma mensagem que MENTE sobre o problema (foi assim
   * que o defeito de medida duplicada ficou invisivel).
   *
   * Chama `criarRascunho` DIRETO (sem passar pelo dedup do service, que
   * agora impede este cenario de acontecer pela API publica) com DUAS
   * medidas do MESMO tipo -- violacao deliberada de
   * `body_measurements_assessment_id_type_key` -- e prova que o erro que
   * escapa NAO e `AvaliacaoJaExisteParaOrigemError`.
   */
  describe('P2002 de outra origem nao vira "sessao ja confirmada"', () => {
    it('violar o unique de body_measurements propaga o erro como ele mesmo', async () => {
      const studentId = await criarAluno(contas.a);

      // `evaluatorUserId` tem FK (`onDelete: Restrict`) -- precisa ser um
      // usuario REAL, ou o `create` falha antes de chegar perto do unique
      // que este teste quer violar.
      const avaliador = await db.user.findFirstOrThrow({ where: { email: contas.a.email } });

      const contexto: TenantContext = {
        tenantId: contas.a.tenantId,
        actorId: randomUUID(),
        sessionId: randomUUID(),
        permissions: new Set(),
        allowedUnitIds: 'ALL',
      };

      const medidaDuplicada = {
        type: 'WEIGHT' as const,
        originalValue: 88.4,
        originalUnit: 'kg' as const,
        canonicalValue: 88.4,
        canonicalUnit: 'kg' as const,
      };

      let erroCapturado: unknown;

      try {
        await avaliacoesRepo.criarRascunho(contexto, studentId, {
          assessedAt: new Date('2026-08-10T12:00:00.000Z'),
          evaluatorUserId: avaliador.id,
          // DUAS medidas do MESMO tipo -- viola
          // `body_measurements_assessment_id_type_key`, NAO o indice de
          // sessao. Sem `source: 'IMPORT'`/`sourceReference`: este teste
          // isola a causa, garantindo que nem o indice novo participa.
          medidas: [medidaDuplicada, medidaDuplicada],
        });
      } catch (erro) {
        erroCapturado = erro;
      }

      // O erro que ESCAPOU nao pode ser "sessao ja confirmada" -- essa
      // causa e de OUTRO indice, e disfarça-la e o defeito que este teste
      // existe para pegar.
      expect(erroCapturado).not.toBeInstanceOf(AvaliacaoJaExisteParaOrigemError);

      // E, positivamente, o erro que escapou e o P2002 CRU do Prisma --
      // prova de que a narrow por `meta.target` funcionou (reconheceu que
      // este P2002 NAO era do indice de sessao), em vez de algum outro erro
      // ter mascarado o cenario.
      expect(erroCapturado).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((erroCapturado as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
    });
  });
});
