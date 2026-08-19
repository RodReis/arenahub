import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F8 -- consentimento biometrico, pela porta da frente.
 *
 * O que este arquivo prova, e que teste de constraint nao alcanca:
 *
 *   - recusar biometria NAO impede cadastro nem acesso (INV-017, INV-022b);
 *   - menor de 18 exige responsavel legal identificado (INV-143);
 *   - a virada dos 18 invalida o consentimento do responsavel;
 *   - revogar cria decisao nova sem reescrever a anterior (INV-021);
 *   - isolamento entre tenants nas rotas novas (INV-006);
 *   - o SHA-256 do termo e calculado no servidor, nao aceito do cliente.
 */
describe('F8 -- consentimento biometrico', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: { email: `f8-a-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
    b: { email: `f8-b-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
  };

  const PERMISSOES = [
    'student.create',
    'student.read',
    'consent.manage',
    'consent.read',
  ];

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

    // A F45 tornou `students.gym_unit_id` obrigatorio: todo aluno nasce numa
    // unidade de ORIGEM. Consentimento biometrico nao consulta unidade -- ela
    // existe aqui so para o aluno da fixture ser valido.
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

  /** Publica o termo vigente do tenant. */
  const publicarTermo = async (
    conta: (typeof contas)['a'],
    versao: number,
  ): Promise<request.Response> =>
    request(servidor())
      .post('/api/v1/consent-documents/biometric')
      .set('Cookie', conta.cookie)
      .send({
        version: versao,
        purpose: 'Identificacao facial para controle de acesso a academia',
        content: `Termo de consentimento biometrico versao ${versao}. `.repeat(3),
      });

  const criarAluno = async (
    conta: (typeof contas)['a'],
    nascimento: string,
  ): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName: 'Aluno De Teste',
        birthDate: nascimento,
        gymUnitId: conta.gymUnitId,
        contacts: [],
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  /** Nascimento que produz a idade pedida hoje. */
  const nascimentoParaIdade = (anos: number): string => {
    const hoje = new Date();
    const data = new Date(
      Date.UTC(hoje.getUTCFullYear() - anos, hoje.getUTCMonth(), hoje.getUTCDate()),
    );

    return data.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);

    await montarAcademia(contas.a, `f8-academia-a-${sufixo}`);
    await montarAcademia(contas.b, `f8-academia-b-${sufixo}`);

    await publicarTermo(contas.a, 1);
    await publicarTermo(contas.b, 1);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('publicacao do termo', () => {
    it('calcula o SHA-256 no servidor', async () => {
      const conteudo = `Termo especifico para hash ${sufixo}. `.repeat(3);

      const resposta = await request(servidor())
        .post('/api/v1/consent-documents/biometric')
        .set('Cookie', contas.a.cookie)
        .send({
          version: 50,
          purpose: 'Identificacao facial para controle de acesso',
          content: conteudo,
        });

      expect(resposta.status).toBe(201);

      const esperado = createHash('sha256').update(conteudo, 'utf8').digest('hex');

      // Aceitar o hash do cliente deixaria a prova valer o que o cliente
      // disser que ela vale.
      expect((resposta.body as { contentSha256: string }).contentSha256).toBe(esperado);
    });

    it('recusa hash enviado pelo cliente', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/consent-documents/biometric')
        .set('Cookie', contas.a.cookie)
        .send({
          version: 51,
          purpose: 'Identificacao facial para controle de acesso',
          content: 'Conteudo com hash forjado. '.repeat(3),
          contentSha256: 'f'.repeat(64),
        });

      // `.strict()` no schema: campo desconhecido e RECUSADO, nao ignorado.
      expect(resposta.status).toBe(400);
    });

    it('aposenta a versao anterior sem apaga-la', async () => {
      await publicarTermo(contas.a, 60);
      await publicarTermo(contas.a, 61);

      const versoes = await db.consentDocument.findMany({
        where: { tenantId: contas.a.tenantId, version: { in: [60, 61] } },
        orderBy: { version: 'asc' },
      });

      // A versao 60 continua existindo: ha consentimento apontando para ela.
      expect(versoes).toHaveLength(2);
      expect(versoes[0]?.retiredAt).not.toBeNull();
      expect(versoes[1]?.retiredAt).toBeNull();
    });
  });

  describe('decisao do titular maior de idade', () => {
    it('aceita e autoriza cadastro biometrico', async () => {
      const alunoId = await criarAluno(contas.a, nascimentoParaIdade(30));

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-consent`)
        .set('Cookie', contas.a.cookie)
        .send({ decision: 'ACCEPTED' });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({
        decision: 'ACCEPTED',
        subjectKind: 'STUDENT',
        allowsBiometricEnrollment: true,
        blockedReason: null,
      });
    });

    it('recusa biometria SEM impedir o cadastro do aluno (INV-017, INV-022b)', async () => {
      const alunoId = await criarAluno(contas.a, nascimentoParaIdade(25));

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-consent`)
        .set('Cookie', contas.a.cookie)
        .send({ decision: 'REFUSED' });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({
        decision: 'REFUSED',
        allowsBiometricEnrollment: false,
        blockedReason: 'CONSENT_REFUSED',
      });

      // O aluno continua la, ativo. Recusar biometria nao pode custar a
      // matricula -- e o que torna o consentimento livre em vez de coacao.
      const aluno = await request(servidor())
        .get(`/api/v1/students/${alunoId}`)
        .set('Cookie', contas.a.cookie);

      expect(aluno.status).toBe(200);
    });

    it('recusa dados de responsavel para aluno maior de idade', async () => {
      const alunoId = await criarAluno(contas.a, nascimentoParaIdade(28));

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-consent`)
        .set('Cookie', contas.a.cookie)
        .send({
          decision: 'ACCEPTED',
          guardianName: 'Alguem Que Nao Deveria',
          guardianRelation: 'PAI',
        });

      // Aceitar em silencio gravaria uma decisao que atribui a outra pessoa
      // o consentimento de quem ja decide por si.
      expect(resposta.status).toBe(400);
      expect(resposta.body).toMatchObject({ code: 'CONSENT_GUARDIAN_NOT_ALLOWED' });
    });
  });

  describe('menor de 18 (INV-143)', () => {
    it('exige responsavel legal identificado', async () => {
      const alunoId = await criarAluno(contas.a, nascimentoParaIdade(15));

      const semResponsavel = await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-consent`)
        .set('Cookie', contas.a.cookie)
        .send({ decision: 'ACCEPTED' });

      expect(semResponsavel.status).toBe(400);
      expect(semResponsavel.body).toMatchObject({ code: 'CONSENT_GUARDIAN_REQUIRED' });
    });

    it('exige o grau de parentesco, nao so o nome', async () => {
      const alunoId = await criarAluno(contas.a, nascimentoParaIdade(16));

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-consent`)
        .set('Cookie', contas.a.cookie)
        .send({ decision: 'ACCEPTED', guardianName: 'Responsavel Sem Vinculo' });

      // Vinculo COMPROVAVEL e a exigencia do ADR-008; nome solto nao
      // comprova nada.
      expect(resposta.status).toBe(400);
      expect(resposta.body).toMatchObject({ code: 'CONSENT_GUARDIAN_REQUIRED' });
    });

    it('aceita com responsavel legal completo e congela a idade da decisao', async () => {
      const alunoId = await criarAluno(contas.a, nascimentoParaIdade(16));

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-consent`)
        .set('Cookie', contas.a.cookie)
        .send({
          decision: 'ACCEPTED',
          guardianName: 'Responsavel De Teste',
          guardianRelation: 'MAE',
        });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({
        subjectKind: 'LEGAL_GUARDIAN',
        allowsBiometricEnrollment: true,
      });

      const registro = await db.consentRecord.findFirst({
        where: { tenantId: contas.a.tenantId, studentId: alunoId },
        orderBy: { occurredAt: 'desc' },
      });

      // Idade congelada: e o que permite saber, depois, que o consentimento
      // veio do responsavel quando o aluno tinha 16.
      expect(registro?.subjectAgeYears).toBe(16);
      expect(registro?.guardianRelation).toBe('MAE');
    });

    it('invalida o consentimento do responsavel quando o aluno completa 18', async () => {
      // Aluno que ja tem 18 hoje, mas cujo consentimento foi dado pelo
      // responsavel -- o cenario da virada.
      const alunoId = await criarAluno(contas.a, nascimentoParaIdade(18));

      const documento = await db.consentDocument.findFirst({
        where: { tenantId: contas.a.tenantId, retiredAt: null },
      });

      await db.consentRecord.create({
        data: {
          tenantId: contas.a.tenantId,
          studentId: alunoId,
          documentId: documento!.id,
          decision: 'ACCEPTED',
          subjectKind: 'LEGAL_GUARDIAN',
          guardianName: 'Responsavel De Teste',
          guardianRelation: 'PAI',
          subjectAgeYears: 16,
          occurredAt: new Date('2024-01-01T00:00:00.000Z'),
        },
      });

      const resposta = await request(servidor())
        .get(`/api/v1/students/${alunoId}/biometric-consent`)
        .set('Cookie', contas.a.cookie);

      expect(resposta.status).toBe(200);
      // A prova do que aconteceu continua valida; o que caduca e a
      // AUTORIZACAO. Quem decide sobre o proprio corpo passa a ser ele.
      expect(resposta.body).toMatchObject({
        allowsBiometricEnrollment: false,
        blockedReason: 'CONSENT_REVALIDATION_REQUIRED',
      });
    });
  });

  describe('revogacao (INV-021)', () => {
    it('cria decisao nova sem reescrever a anterior', async () => {
      const alunoId = await criarAluno(contas.a, nascimentoParaIdade(30));

      const aceite = await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-consent`)
        .set('Cookie', contas.a.cookie)
        .send({ decision: 'ACCEPTED' });

      const idDoAceite = (aceite.body as { id: string }).id;

      await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-consent`)
        .set('Cookie', contas.a.cookie)
        .send({ decision: 'REFUSED' });

      const original = await db.consentRecord.findUnique({ where: { id: idDoAceite } });

      // Apagar a decisao passada destruiria a prova de que houve
      // consentimento no periodo em que a biometria funcionou.
      expect(original?.decision).toBe('ACCEPTED');
      expect(original?.supersededAt).not.toBeNull();

      const atual = await request(servidor())
        .get(`/api/v1/students/${alunoId}/biometric-consent`)
        .set('Cookie', contas.a.cookie);

      expect(atual.body).toMatchObject({
        decision: 'REFUSED',
        allowsBiometricEnrollment: false,
      });
    });

    it('registra ator e user-agent na decisao (INV-021)', async () => {
      const alunoId = await criarAluno(contas.a, nascimentoParaIdade(22));

      await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-consent`)
        .set('Cookie', contas.a.cookie)
        .set('User-Agent', 'recepcao-teste/1.0')
        .send({ decision: 'ACCEPTED' });

      const registro = await db.consentRecord.findFirst({
        where: { tenantId: contas.a.tenantId, studentId: alunoId },
        orderBy: { occurredAt: 'desc' },
      });

      // "Quem coletou" e a primeira pergunta numa fiscalizacao.
      expect(registro?.actorId).not.toBeNull();
      expect(registro?.actorUserAgent).toBe('recepcao-teste/1.0');
    });
  });

  describe('isolamento entre tenants (INV-006)', () => {
    it('nao registra consentimento para aluno de outro tenant', async () => {
      const alunoDoA = await criarAluno(contas.a, nascimentoParaIdade(30));

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoDoA}/biometric-consent`)
        .set('Cookie', contas.b.cookie)
        .send({ decision: 'ACCEPTED' });

      // 404, nunca 403: 403 confirmaria que o aluno existe noutro tenant.
      expect(resposta.status).toBe(404);
      expect(resposta.body).toMatchObject({ code: 'STUDENT_NOT_FOUND' });
    });

    it('nao consulta consentimento de aluno de outro tenant', async () => {
      const alunoDoA = await criarAluno(contas.a, nascimentoParaIdade(30));

      const resposta = await request(servidor())
        .get(`/api/v1/students/${alunoDoA}/biometric-consent`)
        .set('Cookie', contas.b.cookie);

      expect(resposta.status).toBe(404);
    });

    it('cada tenant enxerga o proprio termo vigente', async () => {
      const doA = await request(servidor())
        .get('/api/v1/consent-documents/biometric/current')
        .set('Cookie', contas.a.cookie);

      const doB = await request(servidor())
        .get('/api/v1/consent-documents/biometric/current')
        .set('Cookie', contas.b.cookie);

      expect(doA.status).toBe(200);
      expect(doB.status).toBe(200);
      expect((doA.body as { id: string }).id).not.toBe((doB.body as { id: string }).id);
    });
  });

  describe('permissao', () => {
    it('exige autenticacao', async () => {
      const resposta = await request(servidor()).get(
        '/api/v1/consent-documents/biometric/current',
      );

      expect(resposta.status).toBe(401);
    });
  });
});
