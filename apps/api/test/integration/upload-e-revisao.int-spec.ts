import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import type { BodyMeasurementType, MeasurementUnit } from '@arenahub/database';

import { ImportService } from '../../src/modules/health/import.service.js';
import { FakeMalwareScannerAdapter } from '../../src/modules/health/provider/fake-malware-scanner.adapter.js';
import { FakeOcrExtractorAdapter } from '../../src/modules/health/provider/fake-ocr-extractor.adapter.js';
import { DOCUMENT_EXTRACTOR, ErroDeExtracao } from '../../src/modules/health/provider/document-extractor.port.js';
import { ErroDoScanner } from '../../src/modules/health/provider/malware-scanner.port.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F19 -- upload e revisao, pela porta da frente.
 *
 * ADR-039 (21/08/2026) revogou a regra no 8 na parte do OCR, `M3-BR-006` e
 * `M3-AC-005`: o laudo extraido PUBLICA AUTOMATICAMENTE, sem revisao campo a
 * campo. O que este arquivo prova, e que teste de funcao pura NAO alcanca:
 *
 *   - upload sozinho ja cria a avaliacao PUBLICADA -- sem nenhuma chamada de
 *     revisao (ADR-039);
 *   - baixa confianca NAO segura nada -- decisao explicita do PI, para
 *     ninguem "corrigir de volta" (ADR-039);
 *   - campo que o extrator nao leu (`extractedValue === null`) vira
 *     DISCARDED, nunca CONFIRMED -- nao virou zero nem medida (INV-104);
 *   - o que o OCR leu continua guardado no campo mesmo sem revisao humana
 *     (proveniencia, aceite da Slice 3.3);
 *   - falha na publicacao automatica NAO derruba o upload -- a importacao
 *     fica `EXTRACTED` e a revisao manual (campo a campo) continua
 *     funcionando como caminho de contingencia;
 *   - `health.upload` sozinho basta para anexar; sem ela, 403;
 *   - arquivo infectado e recusado e NAO fica no storage;
 *   - INV-140: extrator fora nao impede avaliacao manual;
 *   - executavel disfarcado de PDF e recusado pela ASSINATURA;
 *   - isolamento entre tenants (INV-006).
 *
 * `DOCUMENT_EXTRACTOR` e sobrescrito para `FakeOcrExtractorAdapter` NESTA
 * suite: em producao o roteador (`DocumentExtractorRouterAdapter`) manda PDF
 * para o extrator real de bioimpedancia/ECG, mas o fixture `PDF` deste
 * arquivo e generico (so a assinatura de bytes) -- exatamente o caso que o
 * dublê de OCR ainda cobre (imagem/PDF sem extrator real). Sem o override, o
 * PDF cairia no extrator real e os campos plantados aqui (confidence
 * 0.42/0.97, falha programada) nunca apareceriam.
 */
describe('F19 -- upload e revisao', () => {
  let app: INestApplication;
  let db: PrismaService;
  let scanner: FakeMalwareScannerAdapter;
  let ocr: FakeOcrExtractorAdapter;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: { email: `f19-a-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
    b: { email: `f19-b-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
  };

  const PERMISSOES = ['student.create', 'student.read', 'health.read', 'health.assess', 'health.upload'];

  /** Objetos gravados pelo storage falso, para conferir o que foi guardado. */
  const gravados = new Map<string, Buffer>();

  const storageFalso = {
    createPrivateUpload: () =>
      Promise.resolve({ uploadUrl: 'https://storage.test/x', expiresAt: '' }),
    headPrivateObject: () => Promise.resolve({ size: 1, contentType: 'application/pdf' }),
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

  /**
   * Um usuario NOVO no tenant de `contas.a`, com um conjunto de permissoes
   * PROPRIO (nunca `PERMISSOES` inteiro) -- para provar isolamento de
   * permissao (ADR-039: `health.upload` sozinho basta; sem ela, 403).
   */
  const montarUsuarioComPermissoes = async (
    permissoes: readonly string[],
  ): Promise<{ cookie: string }> => {
    const senhas = app.get(PasswordService);
    const email = `f19-perm-${randomUUID()}@exemplo.test`;

    const user = await db.user.create({
      data: { email, passwordHash: await senhas.gerarHash(SENHA) },
    });

    await db.tenantMembership.create({
      data: { tenantId: contas.a.tenantId, userId: user.id },
    });

    const papel = await db.role.create({
      data: { tenantId: contas.a.tenantId, name: `ROLE-${randomUUID().slice(0, 8)}` },
    });

    const linhas = await Promise.all(
      permissoes.map((code) =>
        db.permission.upsert({ where: { code }, create: { code }, update: {} }),
      ),
    );

    await db.rolePermission.createMany({
      data: linhas.map((p) => ({ roleId: papel.id, permissionId: p.id })),
    });

    await db.userRole.create({
      data: { tenantId: contas.a.tenantId, userId: user.id, roleId: papel.id },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email, password: SENHA });

    return { cookie: cookieDeAcesso(login) };
  };

  /**
   * Semeia uma importacao `EXTRACTED` DIRETO no banco, com os campos dados
   * -- o estado em que a revisao campo a campo manual (M3-FR-010/011) ainda
   * se aplica.
   *
   * Depois de ADR-039 este estado so existe quando `publicarAutomaticamente`
   * falha (import.service.ts trata a falha como SILENCIOSA de proposito, e
   * a importacao fica em `EXTRACTED`) -- e nao ha hoje um jeito de FORCAR
   * essa falha pela porta da frente com um upload valido (todo extrator
   * ligado ou publica com sucesso ou vira `FAILED` antes de gravar campo
   * nenhum). Semear direto reproduz o estado que a tela de revisao manual
   * encontra nesse cenario, sem depender de mockar uma falha interna.
   */
  const criarImportacaoExtraida = async (
    studentId: string,
    campos: readonly { type: BodyMeasurementType; value: number; unit?: MeasurementUnit }[],
  ): Promise<string> => {
    const uploader = await db.user.findFirstOrThrow({ where: { email: contas.a.email } });

    const importacao = await db.assessmentImport.create({
      data: {
        tenantId: contas.a.tenantId,
        studentId,
        status: 'EXTRACTED',
        originalFilename: 'laudo.pdf',
        fileType: 'PDF',
        fileSizeBytes: 10,
        uploadedByUserId: uploader.id,
        extractor: 'fake-ocr@1',
      },
    });

    await db.importedField.createMany({
      data: campos.map((campo) => ({
        tenantId: contas.a.tenantId,
        importId: importacao.id,
        type: campo.type,
        state: 'PENDING' as const,
        extractedValue: campo.value,
        extractedUnit: campo.unit ?? 'KG',
      })),
    });

    return importacao.id;
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

  const CSV = [
    'tipo,valor,unidade',
    'WEIGHT,90.5,kg',
    'BODY_FAT_PERCENT,24.1,percent',
  ].join('\n');

  const PDF = Buffer.concat([
    Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
    Buffer.from('conteudo do laudo'),
  ]);

  /**
   * Este arquivo so testa upload de UM arquivo por vez (F19) -- cada upload
   * E o ultimo (e unico) da propria sessao, entao `ultimoDaSessao: 'true'`
   * vai em TODO envio daqui. Sem ela, a importacao ficaria `EXTRACTED`
   * esperando um segundo arquivo que nunca chega (ver `sessao-multiarquivo`
   * para o caso de sessao com varios arquivos).
   */
  const enviar = async (
    conta: { cookie: string },
    studentId: string,
    conteudo: Buffer,
    nome: string,
    tipo: string,
  ): Promise<request.Response> =>
    request(servidor())
      .post(`/api/v1/students/${studentId}/assessment-imports`)
      .set('Cookie', conta.cookie)
      .field('ultimoDaSessao', 'true')
      .attach('file', conteudo, { filename: nome, contentType: tipo });

  interface CampoResposta {
    id: string;
    type: string;
    extractedValue: number | null;
    confidence: number | null;
    state: string;
    reviewedValue: number | null;
  }

  interface ImportacaoResposta {
    id: string;
    status: string;
    failureReason: string | null;
    assessmentId: string | null;
    fields: CampoResposta[];
  }

  const detalhar = async (
    conta: (typeof contas)['a'],
    importId: string,
  ): Promise<ImportacaoResposta> => {
    const resposta = await request(servidor())
      .get(`/api/v1/assessment-imports/${importId}`)
      .set('Cookie', conta.cookie);

    expect(resposta.status).toBe(200);

    return resposta.body as ImportacaoResposta;
  };

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

  const confirmar = async (
    conta: (typeof contas)['a'],
    importId: string,
    assessedAt = '2026-08-10T12:00:00.000Z',
  ): Promise<request.Response> =>
    request(servidor())
      .post(`/api/v1/assessment-imports/${importId}/confirm`)
      .set('Cookie', conta.cookie)
      .send({ assessedAt });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storageFalso)
      .overrideProvider(DOCUMENT_EXTRACTOR)
      .useFactory({
        factory: (adapter: FakeOcrExtractorAdapter) => adapter,
        inject: [FakeOcrExtractorAdapter],
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    scanner = app.get(FakeMalwareScannerAdapter);
    ocr = app.get(FakeOcrExtractorAdapter);

    await montarAcademia(contas.a, `f19-academia-a-${sufixo}`);
    await montarAcademia(contas.b, `f19-academia-b-${sufixo}`);
  });

  afterEach(() => {
    // Instancias compartilhadas na suite: falha programada num bloco e
    // esquecida contamina o proximo.
    scanner.resetar();
    ocr.resetar();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('aceitacao do arquivo (M3-FR-009)', () => {
    it('aceita CSV, extrai os campos e publica automaticamente (ADR-039)', async () => {
      const aluno = await criarAluno(contas.a);

      const resposta = await enviar(contas.a, aluno, Buffer.from(CSV), 'laudo.csv', 'text/csv');

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ status: 'CONFIRMED', extractedFields: 2 });
    });

    /**
     * Extensao e `content-type` sao AMBOS controlados por quem envia. A
     * assinatura nos primeiros bytes e o unico sinal que vem do arquivo.
     */
    it('recusa executavel disfarcado de PDF', async () => {
      const aluno = await criarAluno(contas.a);
      const executavel = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);

      const resposta = await enviar(
        contas.a,
        aluno,
        executavel,
        'laudo.pdf',
        'application/pdf',
      );

      expect(resposta.status).toBe(400);
      expect((resposta.body as { code: string }).code).toBe('FILE_SIGNATURE_UNKNOWN');
    });

    it('recusa tipo fora da lista', async () => {
      const aluno = await criarAluno(contas.a);

      const resposta = await enviar(
        contas.a,
        aluno,
        Buffer.from('qualquer'),
        'a.exe',
        'application/x-msdownload',
      );

      expect(resposta.status).toBe(400);
      expect((resposta.body as { code: string }).code).toBe('FILE_TYPE_NOT_ALLOWED');
    });
  });

  describe('antivirus', () => {
    /** EICAR e o padrao que a industria criou exatamente para este teste. */
    it('recusa arquivo infectado e NAO o guarda no storage', async () => {
      const aluno = await criarAluno(contas.a);
      const eicar = Buffer.from(
        `${'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR'}-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`,
      );
      const antes = gravados.size;

      const resposta = await enviar(contas.a, aluno, eicar, 'v.csv', 'text/csv');

      expect(resposta.body).toMatchObject({ status: 'INFECTED' });
      // Nada foi guardado: o antivirus roda ANTES do storage.
      expect(gravados.size).toBe(antes);

      const linha = await db.assessmentImport.findFirstOrThrow({
        where: { id: (resposta.body as { id: string }).id },
      });
      expect(linha.objectKey).toBeNull();
      expect(linha.failureReason).toContain('EICAR');
    });

    it('scanner fora do ar NAO guarda o arquivo -- na duvida, nao entra', async () => {
      const aluno = await criarAluno(contas.a);
      const antes = gravados.size;

      scanner.programarFalha(new ErroDoScanner('SCANNER_UNAVAILABLE', 'fora do ar'));

      const resposta = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');

      expect(resposta.body).toMatchObject({ status: 'FAILED' });
      expect(gravados.size).toBe(antes);
    });
  });

  describe('ADR-039 -- o laudo publica automaticamente, sem revisao campo a campo', () => {
    /**
     * O teste central da decisao: upload sozinho, NENHUMA chamada de
     * revisao, e a avaliacao ja nasce PUBLICADA. Ate 21/08/2026 este mesmo
     * upload deixava a importacao em `EXTRACTED` esperando um humano
     * confirmar campo a campo (INV-103/`M3-BR-006`) -- o PI revogou a regra
     * porque a tela ficava parada e a academia voltava ao papel.
     */
    it('upload com CSV valido ja cria a avaliacao PUBLICADA, sem nenhuma chamada de revisao', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');

      expect(envio.status).toBe(201);
      expect(envio.body).toMatchObject({ status: 'CONFIRMED' });

      const importId = (envio.body as { id: string }).id;
      const linha = await db.assessmentImport.findFirstOrThrow({ where: { id: importId } });

      expect(linha.status).toBe('CONFIRMED');
      expect(linha.assessmentId).not.toBeNull();

      const avaliacao = await db.bodyAssessment.findFirstOrThrow({
        where: { id: linha.assessmentId! },
      });
      expect(avaliacao.status).toBe('PUBLISHED');

      const medidas = await db.bodyMeasurement.findMany({
        where: { assessmentId: avaliacao.id },
      });
      const tipos = medidas.map((m) => m.type);
      expect(tipos).toContain('WEIGHT');
      expect(tipos).toContain('BODY_FAT_PERCENT');
    });

    /**
     * O revisor gravado e o UPLOADER: nao houve avaliador nenhum olhando
     * campo a campo, entao quem "revisou" e quem anexou o arquivo -- e a
     * constraint do banco (revisor obrigatorio) continua satisfeita.
     */
    it('a avaliacao criada registra o UPLOADER como revisor', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');
      const importId = (envio.body as { id: string }).id;

      const linha = await db.assessmentImport.findFirstOrThrow({ where: { id: importId } });

      expect(linha.status).toBe('CONFIRMED');
      expect(linha.reviewedByUserId).not.toBeNull();
      expect(linha.reviewedAt).not.toBeNull();
      expect(linha.reviewedByUserId).toBe(linha.uploadedByUserId);
    });

    /**
     * BAIXA CONFIANCA NAO SEGURA NADA -- decisao EXPLICITA do PI em
     * 21/08/2026, documentada no ADR-039. O campo `INTRACELLULAR_WATER` do
     * fake OCR tem `confidence: 0.42` (o mais baixo do fixture) e ainda
     * assim vira medida publicada. Pinado aqui de proposito: a alternativa
     * (reter so o campo duvidoso) foi apresentada ao PI e RECUSADA -- se
     * algum dia alguem "corrigir" isto para segurar baixa confianca, este
     * teste quebra e aponta direto para a decisao que foi revertida.
     */
    it('campo de BAIXA CONFIANCA publica igual -- decisao explicita do PI', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, PDF, 'laudo.pdf', 'application/pdf');

      expect(envio.body).toMatchObject({ status: 'CONFIRMED' });

      const importId = (envio.body as { id: string }).id;
      const linha = await db.assessmentImport.findFirstOrThrow({ where: { id: importId } });

      const medidas = await db.bodyMeasurement.findMany({
        where: { assessmentId: linha.assessmentId! },
      });
      const agua = medidas.find((m) => m.type === 'INTRACELLULAR_WATER');

      // O valor de confianca 0.42 -- o mais baixo do laudo -- entrou como
      // medida, com o valor exato que o OCR leu (o fake planta o erro real:
      // 3,15 em vez de 31,5). Nada segurou o campo suspeito.
      expect(agua).toBeDefined();
      expect(agua?.canonicalValue.toNumber()).toBe(3.15);

      // E a proveniencia continua gravada no campo: o extractedValue nunca
      // e sobrescrito, mesmo sem revisao humana -- e o que permite a
      // CORRECAO VINCULADA depois (INV-102, fora do escopo deste arquivo).
      const camposDoImport = await db.importedField.findMany({ where: { importId } });
      const campoAgua = camposDoImport.find((c) => c.type === 'INTRACELLULAR_WATER');

      expect(campoAgua?.state).toBe('CONFIRMED');
      expect(campoAgua?.extractedValue?.toNumber()).toBe(3.15);
      expect(campoAgua?.confidence?.toNumber()).toBe(0.42);
    });

    /**
     * `health.upload` sozinho ja basta para anexar (ADR-039): a recepcao
     * NAO tem `health.assess` nem `health.read`, e o upload ainda assim
     * publica a avaliacao -- a separacao do ADR-037 (quem anexa nao e quem
     * le/mede) continua de pe, so que agora sem barreira de revisao.
     */
    it('health.upload sozinho basta para anexar e publicar', async () => {
      const aluno = await criarAluno(contas.a);
      const recepcao = await montarUsuarioComPermissoes(['health.upload']);

      const resposta = await enviar(recepcao, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ status: 'CONFIRMED' });
    });

    /** Sem `health.upload`, a rota nem deixa anexar -- 403, nao 404 nem 201. */
    it('sem health.upload a rota responde 403', async () => {
      const aluno = await criarAluno(contas.a);
      const semPermissao = await montarUsuarioComPermissoes(['health.read', 'health.assess']);

      const resposta = await enviar(semPermissao, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');

      expect(resposta.status).toBe(403);
    });

    /**
     * `extractedValue === null` NUNCA acontece hoje pelos extratores
     * ligados (CSV e o fake de OCR sempre emitem um numero -- uma linha
     * ilegivel do CSV e simplesmente OMITIDA, nunca vira campo com valor
     * nulo). O schema documenta o caso ("nulo quando o extrator marcou o
     * campo como ilegivel") para um extrator futuro que precise dele, e
     * `import.service.ts` ja trata esse caso (DISCARDED, nao CONFIRMED) --
     * este teste prova essa branch chamando `publicarAutomaticamente`
     * (privado) direto, com um campo semeado manualmente no banco, porque
     * nao ha hoje um caminho HTTP que o produza.
     */
    it('campo que o extrator NAO leu (extractedValue null) vira DISCARDED, nao medida', async () => {
      const aluno = await criarAluno(contas.a);
      const importService = app.get(ImportService);

      const contexto: TenantContext = {
        tenantId: contas.a.tenantId,
        actorId: randomUUID(),
        sessionId: randomUUID(),
        permissions: new Set(),
        allowedUnitIds: 'ALL',
      };

      const uploader = await db.user.findFirstOrThrow({ where: { email: contas.a.email } });

      const importacao = await db.assessmentImport.create({
        data: {
          tenantId: contas.a.tenantId,
          studentId: aluno,
          status: 'EXTRACTED',
          originalFilename: 'ilegivel.csv',
          fileType: 'CSV',
          fileSizeBytes: 10,
          uploadedByUserId: uploader.id,
          extractor: 'fake-ocr@1',
        },
      });

      // Um campo que o extrator leu (WEIGHT) e outro que NAO conseguiu ler
      // (BODY_FAT_PERCENT, extractedValue null) -- o caso real que o schema
      // documenta ("nulo quando o extrator marcou o campo como ilegivel").
      await db.importedField.create({
        data: {
          tenantId: contas.a.tenantId,
          importId: importacao.id,
          type: 'WEIGHT',
          state: 'PENDING',
          extractedValue: 90.5,
          extractedUnit: 'KG',
        },
      });
      const campoIlegivel = await db.importedField.create({
        data: {
          tenantId: contas.a.tenantId,
          importId: importacao.id,
          type: 'BODY_FAT_PERCENT',
          state: 'PENDING',
          extractedValue: null,
        },
      });

      // Metodo privado -- unico jeito de exercitar esta branch, ja que
      // nenhum extrator ligado hoje produz `extractedValue: null` (ver
      // comentario do teste acima).
      const service = importService as unknown as {
        publicarAutomaticamente(
          contexto: TenantContext,
          importId: string,
          autorId: string,
          assessedAt: Date,
          agora: Date,
        ): Promise<boolean>;
      };
      const agora = new Date('2026-08-21T12:00:00.000Z');
      const publicada = await service.publicarAutomaticamente(
        contexto,
        importacao.id,
        uploader.id,
        agora,
        agora,
      );

      expect(publicada).toBe(true);

      const campoGravado = await db.importedField.findUniqueOrThrow({
        where: { id: campoIlegivel.id },
      });
      // DISCARDED, nao CONFIRMED: confirmar um valor ausente gravaria "medi
      // e nao achei" como se fosse medida (INV-104).
      expect(campoGravado.state).toBe('DISCARDED');

      const linhaFinal = await db.assessmentImport.findUniqueOrThrow({
        where: { id: importacao.id },
      });
      const medidas = await db.bodyMeasurement.findMany({
        where: { assessmentId: linhaFinal.assessmentId! },
      });

      // So WEIGHT virou medida -- BODY_FAT_PERCENT (null, descartado) nao
      // aparece nem como zero.
      expect(medidas).toHaveLength(1);
      expect(medidas[0]!.type).toBe('WEIGHT');
    });
  });

  /**
   * A revisao campo a campo (`M3-FR-010`, `M3-FR-011`) NAO foi removida --
   * ADR-039 tirou a OBRIGATORIEDADE dela antes de publicar, nao a rota. Ela
   * continua sendo o caminho de CONTINGENCIA para quando a publicacao
   * automatica falha (import.service.ts trata a falha como silenciosa: a
   * importacao fica `EXTRACTED` e a tela manual segue funcionando).
   *
   * Os testes usam `criarImportacaoExtraida` (semeada direto no banco) para
   * reproduzir esse estado -- nao ha hoje um upload valido que force
   * `publicarAutomaticamente` a falhar pela porta da frente (ver comentario
   * do helper).
   */
  describe('revisao campo a campo continua existindo -- caminho de contingencia (M3-FR-010/011)', () => {
    it('o valor CORRIGIDO vai para a avaliacao, e o do OCR fica guardado', async () => {
      const aluno = await criarAluno(contas.a);
      const importId = await criarImportacaoExtraida(aluno, [
        // O erro real que motivou a fatia: OCR lendo 3,15 onde o laudo diz 31,5.
        { type: 'INTRACELLULAR_WATER', value: 3.15, unit: 'L' },
        { type: 'WEIGHT', value: 90.5 },
      ]);
      const importacao = await detalhar(contas.a, importId);

      const errado = importacao.fields.find((c) => c.type === 'INTRACELLULAR_WATER')!;
      expect(errado.extractedValue).toBe(3.15);

      await revisar(contas.a, importId, errado.id, {
        state: 'CORRECTED',
        reviewedValue: 31.5,
      });

      for (const campo of importacao.fields.filter((c) => c.id !== errado.id)) {
        await revisar(contas.a, importId, campo.id, { state: 'CONFIRMED' });
      }

      const resposta = await confirmar(contas.a, importId);
      const assessmentId = (resposta.body as { assessmentId: string }).assessmentId;

      const medidas = await db.bodyMeasurement.findMany({ where: { assessmentId } });
      const agua = medidas.find((m) => m.type === 'INTRACELLULAR_WATER');

      // O valor do humano venceu.
      expect(agua?.canonicalValue.toNumber()).toBe(31.5);

      // E o que o OCR leu continua guardado -- proveniencia (aceite da 3.3).
      const campoGravado = await db.importedField.findFirstOrThrow({
        where: { id: errado.id },
      });
      expect(campoGravado.extractedValue?.toNumber()).toBe(3.15);
      expect(campoGravado.reviewedValue?.toNumber()).toBe(31.5);
    });

    /**
     * Descartado nao vira zero nem medida: o campo que o aparelho nao mediu
     * nao e o campo que mediu zero (INV-104). Aqui e um HUMANO descartando
     * no caminho de contingencia -- o descarte AUTOMATICO por valor nulo
     * esta provado em 'campo que o extrator NAO leu' (ADR-039).
     */
    it('campo DESCARTADO por um humano nao vira medida', async () => {
      const aluno = await criarAluno(contas.a);
      const importId = await criarImportacaoExtraida(aluno, [
        { type: 'WEIGHT', value: 90.5 },
        { type: 'BODY_FAT_PERCENT', value: 24.1, unit: 'PERCENT' },
      ]);
      const importacao = await detalhar(contas.a, importId);

      const peso = importacao.fields.find((c) => c.type === 'WEIGHT')!;
      const gordura = importacao.fields.find((c) => c.type === 'BODY_FAT_PERCENT')!;

      await revisar(contas.a, importId, peso.id, { state: 'CONFIRMED' });
      await revisar(contas.a, importId, gordura.id, { state: 'DISCARDED' });

      const resposta = await confirmar(contas.a, importId);
      const assessmentId = (resposta.body as { assessmentId: string }).assessmentId;

      const medidas = await db.bodyMeasurement.findMany({ where: { assessmentId } });

      expect(medidas).toHaveLength(1);
      expect(medidas[0]!.type).toBe('WEIGHT');
    });

    it('descartar TUDO impede a confirmacao', async () => {
      const aluno = await criarAluno(contas.a);
      const importId = await criarImportacaoExtraida(aluno, [
        { type: 'WEIGHT', value: 90.5 },
        { type: 'BODY_FAT_PERCENT', value: 24.1, unit: 'PERCENT' },
      ]);
      const importacao = await detalhar(contas.a, importId);

      for (const campo of importacao.fields) {
        await revisar(contas.a, importId, campo.id, { state: 'DISCARDED' });
      }

      const resposta = await confirmar(contas.a, importId);

      // Avaliacao sem medida nenhuma seria um ponto no grafico que nao mediu
      // nada (INV-104).
      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('IMPORT_HAS_NO_USABLE_FIELD');
    });

    it('corrigir sem valor novo responde 400', async () => {
      const aluno = await criarAluno(contas.a);
      const importId = await criarImportacaoExtraida(aluno, [{ type: 'WEIGHT', value: 90.5 }]);
      const importacao = await detalhar(contas.a, importId);

      const resposta = await revisar(contas.a, importId, importacao.fields[0]!.id, {
        state: 'CORRECTED',
      });

      expect(resposta.status).toBe(400);
    });

    it('a avaliacao criada por revisao manual registra que veio de IMPORT', async () => {
      const aluno = await criarAluno(contas.a);
      const importId = await criarImportacaoExtraida(aluno, [{ type: 'WEIGHT', value: 90.5 }]);
      const importacao = await detalhar(contas.a, importId);

      for (const campo of importacao.fields) {
        await revisar(contas.a, importId, campo.id, { state: 'CONFIRMED' });
      }

      const resposta = await confirmar(contas.a, importId);
      const assessmentId = (resposta.body as { assessmentId: string }).assessmentId;

      const avaliacao = await db.bodyAssessment.findFirstOrThrow({
        where: { id: assessmentId },
      });

      // O aluno ve que o numero veio de arquivo; a auditoria chega ao arquivo
      // pelo id.
      expect(avaliacao.source).toBe('IMPORT');
      expect(avaliacao.sourceReference).toBe(importId);
      expect(avaliacao.status).toBe('PUBLISHED');
    });

    it('importacao ja confirmada nao aceita mais revisao', async () => {
      const aluno = await criarAluno(contas.a);
      const importId = await criarImportacaoExtraida(aluno, [{ type: 'WEIGHT', value: 90.5 }]);
      const importacao = await detalhar(contas.a, importId);

      for (const campo of importacao.fields) {
        await revisar(contas.a, importId, campo.id, { state: 'CONFIRMED' });
      }

      await confirmar(contas.a, importId);

      const resposta = await revisar(contas.a, importId, importacao.fields[0]!.id, {
        state: 'DISCARDED',
      });

      // Sem isto, a avaliacao publicada teria nascido de campos diferentes
      // dos que estao gravados.
      expect(resposta.status).toBe(409);
    });
  });

  /**
   * O caminho NORMAL (upload -> publicacao automatica, sem revisao) ja
   * confirma que uma importacao recem-criada por `enviar` fica CONFIRMED
   * imediatamente -- ver 'importacao ja confirmada nao aceita mais revisao'
   * NO BLOCO ACIMA para a versao com contingencia. Este teste prova a MESMA
   * garantia no caminho comum: upload publica sozinho, e revisar depois
   * responde 409.
   */
  describe('importacao publicada automaticamente nao aceita revisao (ADR-039)', () => {
    it('revisar campo apos o upload auto-publicar responde 409', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');
      const importId = (envio.body as { id: string }).id;
      const importacao = await detalhar(contas.a, importId);

      const resposta = await revisar(contas.a, importId, importacao.fields[0]!.id, {
        state: 'DISCARDED',
      });

      expect(resposta.status).toBe(409);
    });
  });

  describe('ordem de revisao', () => {
    it('menor confianca primeiro -- e onde o avaliador precisa olhar', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, PDF, 'laudo.pdf', 'application/pdf');

      const importacao = await detalhar(contas.a, (envio.body as { id: string }).id);

      const confiancas = importacao.fields.map((c) => c.confidence);
      expect(confiancas[0]).toBe(0.42);
      expect(confiancas[confiancas.length - 1]).toBe(0.97);
    });
  });

  describe('INV-140 -- extrator fora nao impede avaliacao manual', () => {
    it('falha do extrator vira linha FAILED, sem derrubar a requisicao', async () => {
      const aluno = await criarAluno(contas.a);

      ocr.programarFalha(new ErroDeExtracao('EXTRACTOR_UNAVAILABLE', true, 'fora'));

      const resposta = await enviar(contas.a, aluno, PDF, 'l.pdf', 'application/pdf');

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({
        status: 'FAILED',
        failureReason: 'EXTRACTOR_UNAVAILABLE',
      });
    });

    it('a avaliacao manual continua funcionando com o extrator fora', async () => {
      const aluno = await criarAluno(contas.a);

      ocr.programarFalha(new ErroDeExtracao('EXTRACTOR_TIMEOUT', true, 'estourou'));
      await enviar(contas.a, aluno, PDF, 'l.pdf', 'application/pdf');

      const manual = await request(servidor())
        .post(`/api/v1/students/${aluno}/assessments`)
        .set('Cookie', contas.a.cookie)
        .send({
          assessedAt: '2026-08-10T12:00:00.000Z',
          measurements: [{ type: 'WEIGHT', value: 88, unit: 'kg' }],
        });

      expect(manual.status).toBe(201);
    });

    it('CSV ilegivel vira FAILED com motivo', async () => {
      const aluno = await criarAluno(contas.a);

      const resposta = await enviar(
        contas.a,
        aluno,
        Buffer.from('nada,util\nlixo,aqui'),
        'l.csv',
        'text/csv',
      );

      expect(resposta.body).toMatchObject({ status: 'FAILED' });
      expect((resposta.body as { failureReason: string }).failureReason).toBe(
        'EXTRACTOR_NO_CONTENT',
      );
    });
  });

  describe('isolamento entre tenants (INV-006)', () => {
    it('a academia B nao envia arquivo para aluno da academia A', async () => {
      const aluno = await criarAluno(contas.a);

      const resposta = await enviar(contas.b, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');

      expect(resposta.status).toBe(404);
      expect((resposta.body as { code: string }).code).toBe('STUDENT_NOT_FOUND');
    });

    it('a academia B nao le importacao da academia A', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');

      const resposta = await request(servidor())
        .get(`/api/v1/assessment-imports/${(envio.body as { id: string }).id}`)
        .set('Cookie', contas.b.cookie);

      expect(resposta.status).toBe(404);
    });

    it('a academia B nao revisa campo da academia A', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');
      const importId = (envio.body as { id: string }).id;
      const importacao = await detalhar(contas.a, importId);

      const resposta = await revisar(contas.b, importId, importacao.fields[0]!.id, {
        state: 'CONFIRMED',
      });

      expect(resposta.status).toBe(404);
    });
  });

  /**
   * F22 -- Slice 3.6: a operacao ve o que precisa de atencao.
   *
   * Fica NESTE arquivo porque a fila e alimentada pelo fluxo de upload que os
   * blocos acima exercitam: um spec separado teria de recriar tudo isso so
   * para ter o que listar.
   */
  describe('F22 -- painel de importacoes (Slice 3.6)', () => {
    /**
     * Depois de ADR-039, upload valido NUNCA fica pendente -- publica
     * sozinho e sai da fila na hora. O que a fila continua mostrando (e
     * continua precisando mostrar, sem mudanca nenhuma) e FAILED e
     * INFECTED: os dois casos em que o upload nao produz avaliacao nenhuma
     * e alguem PRECISA agir. Trocado `ok.csv` (que so ficava pendente antes
     * da fatia) por um upload infectado, que e o outro caso real da mesma
     * fila.
     */
    it('lista FAILED e INFECTED na MESMA fila', async () => {
      const aluno = await criarAluno(contas.a);

      const eicar = Buffer.from(
        `${'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR'}-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`,
      );
      await enviar(contas.a, aluno, eicar, 'infectado.csv', 'text/csv');

      ocr.programarFalha(new ErroDeExtracao('EXTRACTOR_UNAVAILABLE', true, 'fora'));
      await enviar(contas.a, aluno, PDF, 'falha.pdf', 'application/pdf');
      ocr.resetar();

      const resposta = await request(servidor())
        .get('/api/v1/assessment-imports/pending')
        .set('Cookie', contas.a.cookie);

      expect(resposta.status).toBe(200);

      const fila = resposta.body as { status: string; originalFilename: string }[];
      const nomes = fila.map((l) => l.originalFilename);

      // Quem age sobre as duas e a mesma pessoa -- separar em abas produziria
      // uma aba que ninguem abre.
      expect(nomes).toContain('infectado.csv');
      expect(nomes).toContain('falha.pdf');
    });

    /**
     * `pendingFields` so faz sentido para uma importacao ainda `EXTRACTED`
     * -- o estado de contingencia (ver bloco de revisao manual acima).
     * Upload normal auto-publica e nunca aparece aqui com campo pendente.
     */
    it('a fila diz QUANTOS campos faltam revisar numa importacao EXTRACTED', async () => {
      const aluno = await criarAluno(contas.a);
      const importId = await criarImportacaoExtraida(aluno, [
        { type: 'WEIGHT', value: 90.5 },
        { type: 'BODY_FAT_PERCENT', value: 24.1, unit: 'PERCENT' },
      ]);

      const antes = await request(servidor())
        .get('/api/v1/assessment-imports/pending')
        .set('Cookie', contas.a.cookie);

      const linha = (antes.body as { id: string; pendingFields: number }[]).find(
        (l) => l.id === importId,
      );
      expect(linha?.pendingFields).toBe(2);

      const importacao = await detalhar(contas.a, importId);
      await revisar(contas.a, importId, importacao.fields[0]!.id, { state: 'CONFIRMED' });

      const depois = await request(servidor())
        .get('/api/v1/assessment-imports/pending')
        .set('Cookie', contas.a.cookie);

      const atualizada = (depois.body as { id: string; pendingFields: number }[]).find(
        (l) => l.id === importId,
      );
      expect(atualizada?.pendingFields).toBe(1);
    });

    it('importacao CONFIRMADA sai da fila -- inclusive a publicada automaticamente', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'sai.csv', 'text/csv');
      const importId = (envio.body as { id: string }).id;

      // Upload sozinho ja confirma (ADR-039) -- nenhuma chamada extra aqui.
      const linha = await db.assessmentImport.findFirstOrThrow({ where: { id: importId } });
      expect(linha.status).toBe('CONFIRMED');

      const resposta = await request(servidor())
        .get('/api/v1/assessment-imports/pending')
        .set('Cookie', contas.a.cookie);

      const ids = (resposta.body as { id: string }[]).map((l) => l.id);

      // Fila que nao esvazia e fila que a operacao aprende a ignorar.
      expect(ids).not.toContain(importId);
    });

    it('a fila da academia B nao mostra importacao FAILED da academia A', async () => {
      const aluno = await criarAluno(contas.a);

      ocr.programarFalha(new ErroDeExtracao('EXTRACTOR_UNAVAILABLE', true, 'fora'));
      const envio = await enviar(contas.a, aluno, PDF, 'a.pdf', 'application/pdf');
      ocr.resetar();

      const resposta = await request(servidor())
        .get('/api/v1/assessment-imports/pending')
        .set('Cookie', contas.b.cookie);

      const ids = (resposta.body as { id: string }[]).map((l) => l.id);

      expect(ids).not.toContain((envio.body as { id: string }).id);
    });
  });
});
