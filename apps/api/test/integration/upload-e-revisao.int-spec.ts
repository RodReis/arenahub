import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { FakeMalwareScannerAdapter } from '../../src/modules/health/provider/fake-malware-scanner.adapter.js';
import { FakeOcrExtractorAdapter } from '../../src/modules/health/provider/fake-ocr-extractor.adapter.js';
import { ErroDeExtracao } from '../../src/modules/health/provider/document-extractor.port.js';
import { ErroDoScanner } from '../../src/modules/health/provider/malware-scanner.port.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F19 -- upload e revisao, pela porta da frente.
 *
 * O que este arquivo prova, e que teste de funcao pura NAO alcanca:
 *
 *   - INV-103: campo pendente IMPEDE a confirmacao -- o OCR nao publica
 *     sozinho, e a avaliacao so nasce depois que um humano decidiu;
 *   - o valor CORRIGIDO vai para a avaliacao, e o que o OCR leu continua
 *     guardado (proveniencia, aceite da Slice 3.3);
 *   - campo DESCARTADO nao vira zero nem medida (INV-104);
 *   - arquivo infectado e recusado e NAO fica no storage;
 *   - INV-140: extrator fora nao impede avaliacao manual;
 *   - executavel disfarcado de PDF e recusado pela ASSINATURA;
 *   - isolamento entre tenants (INV-006).
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

  const PERMISSOES = ['student.create', 'student.read', 'health.read', 'health.assess'];

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

  const enviar = async (
    conta: (typeof contas)['a'],
    studentId: string,
    conteudo: Buffer,
    nome: string,
    tipo: string,
  ): Promise<request.Response> =>
    request(servidor())
      .post(`/api/v1/students/${studentId}/assessment-imports`)
      .set('Cookie', conta.cookie)
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
    it('aceita CSV e extrai os campos', async () => {
      const aluno = await criarAluno(contas.a);

      const resposta = await enviar(contas.a, aluno, Buffer.from(CSV), 'laudo.csv', 'text/csv');

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ status: 'EXTRACTED', extractedFields: 2 });
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

  describe('INV-103 -- o OCR nao publica sozinho', () => {
    it('confirmar com campo pendente responde 409 e nao cria avaliacao', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');
      const importId = (envio.body as { id: string }).id;

      const resposta = await confirmar(contas.a, importId);

      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('IMPORT_HAS_PENDING_FIELDS');

      const avaliacoes = await db.bodyAssessment.count({ where: { studentId: aluno } });
      expect(avaliacoes).toBe(0);
    });

    it('a resposta diz QUAL campo falta, para a tela levar o avaliador ate ele', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');
      const importId = (envio.body as { id: string }).id;
      const importacao = await detalhar(contas.a, importId);

      await revisar(contas.a, importId, importacao.fields[0]!.id, { state: 'CONFIRMED' });

      const resposta = await confirmar(contas.a, importId);

      // O `application/problem+json` do projeto tem campos fixos, entao o
      // campo pendente viaja no `title` -- que e o canal que existe.
      expect((resposta.body as { title: string }).title).toContain(importacao.fields[1]!.id);
    });

    it('confirmada carrega o revisor -- e a constraint do banco exige', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');
      const importId = (envio.body as { id: string }).id;
      const importacao = await detalhar(contas.a, importId);

      for (const campo of importacao.fields) {
        await revisar(contas.a, importId, campo.id, { state: 'CONFIRMED' });
      }

      const resposta = await confirmar(contas.a, importId);
      expect(resposta.status).toBe(201);

      const linha = await db.assessmentImport.findFirstOrThrow({ where: { id: importId } });

      expect(linha.status).toBe('CONFIRMED');
      expect(linha.reviewedByUserId).not.toBeNull();
      expect(linha.reviewedAt).not.toBeNull();
      expect(linha.assessmentId).not.toBeNull();
    });
  });

  describe('revisao campo a campo (M3-FR-010, M3-FR-011)', () => {
    it('o valor CORRIGIDO vai para a avaliacao, e o do OCR fica guardado', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, PDF, 'laudo.pdf', 'application/pdf');
      const importId = (envio.body as { id: string }).id;
      const importacao = await detalhar(contas.a, importId);

      // O fake planta o erro real: OCR lendo 3,15 onde o laudo diz 31,5.
      const errado = importacao.fields.find((c) => c.type === 'INTRACELLULAR_WATER');
      expect(errado?.extractedValue).toBe(3.15);

      await revisar(contas.a, importId, errado!.id, {
        state: 'CORRECTED',
        reviewedValue: 31.5,
      });

      for (const campo of importacao.fields.filter((c) => c.id !== errado!.id)) {
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
        where: { id: errado!.id },
      });
      expect(campoGravado.extractedValue?.toNumber()).toBe(3.15);
      expect(campoGravado.reviewedValue?.toNumber()).toBe(31.5);
    });

    /**
     * Descartado nao vira zero nem medida: o campo que o aparelho nao mediu
     * nao e o campo que mediu zero (INV-104).
     */
    it('campo DESCARTADO nao vira medida', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');
      const importId = (envio.body as { id: string }).id;
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
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');
      const importId = (envio.body as { id: string }).id;
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
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');
      const importId = (envio.body as { id: string }).id;
      const importacao = await detalhar(contas.a, importId);

      const resposta = await revisar(contas.a, importId, importacao.fields[0]!.id, {
        state: 'CORRECTED',
      });

      expect(resposta.status).toBe(400);
    });

    it('a avaliacao criada registra que veio de IMPORT', async () => {
      const aluno = await criarAluno(contas.a);
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');
      const importId = (envio.body as { id: string }).id;
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
      const envio = await enviar(contas.a, aluno, Buffer.from(CSV), 'l.csv', 'text/csv');
      const importId = (envio.body as { id: string }).id;
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
});
