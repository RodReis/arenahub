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
 * Fatia F8 -- identidade biometrica, inventario e revogacao.
 *
 * O que este arquivo prova:
 *
 *   - identidade NAO nasce sem consentimento valido (INV-017);
 *   - hardware nao homologado responde codigo estavel, nao 500;
 *   - um job de sync por identidade E por dispositivo (INV-024);
 *   - revogar bloqueia LOGICAMENTE no commit, com exclusao fisica pendente
 *     (INV-018) -- e nao reescreve o consentimento;
 *   - a resposta nunca carrega chave de objeto nem URL de imagem (INV-022).
 */
describe('F8 -- identidade biometrica e dispositivos', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const conta = { email: `f8i-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' };

  const PERMISSOES = [
    'student.create',
    'student.read',
    'consent.manage',
    'consent.read',
    'biometric.enroll',
    'biometric.read',
    'biometric.revoke',
    'device.manage',
    'device.read',
  ];

  /**
   * Storage falso: o teste e sobre a REGRA, nao sobre o MinIO. Objeto de
   * 1024 bytes e o caminho feliz; a chave `vazio` simula upload de 0 byte.
   */
  const storageFalso = {
    createPrivateUpload: (entrada: { key: string }) =>
      Promise.resolve({
        uploadUrl: `https://storage.test/${entrada.key}?assinatura=falsa`,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    headPrivateObject: (key: string) =>
      key.includes('vazio')
        ? Promise.resolve({ size: 0, contentType: 'image/jpeg' })
        : key.includes('ausente')
          ? Promise.reject(new Error('NoSuchKey'))
          : Promise.resolve({ size: 1024, contentType: 'image/jpeg' }),
    deletePrivateObject: () => Promise.resolve(),
    verificar: () => Promise.resolve(true),
  };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  const criarAluno = async (idade = 30): Promise<string> => {
    const hoje = new Date();
    const nascimento = new Date(
      Date.UTC(hoje.getUTCFullYear() - idade, hoje.getUTCMonth(), hoje.getUTCDate()),
    );

    const resposta = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName: 'Aluno Biometrico',
        birthDate: nascimento.toISOString().slice(0, 10),
        contacts: [],
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  const aceitarConsentimento = async (studentId: string): Promise<void> => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/biometric-consent`)
      .set('Cookie', conta.cookie)
      .send({ decision: 'ACCEPTED' });

    expect(resposta.status).toBe(201);
  };

  const criarDispositivo = async (serial: string): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/devices')
      .set('Cookie', conta.cookie)
      .send({
        gymUnitId: conta.gymUnitId,
        kind: 'FACIAL_READER',
        model: 'Inner Fit',
        serial,
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  /** Cria identidade completa: consentimento, upload e cadastro. */
  const criarIdentidade = async (
    studentId: string,
  ): Promise<{ id: string; resposta: request.Response }> => {
    const upload = await request(servidor())
      .post(`/api/v1/students/${studentId}/biometric-identities/upload`)
      .set('Cookie', conta.cookie)
      .send({ gymUnitId: conta.gymUnitId, contentType: 'image/jpeg' });

    expect(upload.status).toBe(201);

    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/biometric-identities`)
      .set('Cookie', conta.cookie)
      .send({
        gymUnitId: conta.gymUnitId,
        uploadToken: (upload.body as { uploadToken: string }).uploadToken,
      });

    return { id: (resposta.body as { id?: string }).id ?? '', resposta };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storageFalso)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);

    const senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: {
        slug: `f8-identidade-${sufixo}`,
        legalName: 'Identidade LTDA',
        displayName: 'Identidade',
      },
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
        name: 'Centro',
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

    await db.consentDocument.create({
      data: {
        tenantId: tenant.id,
        type: 'BIOMETRIC',
        version: 1,
        purpose: 'Identificacao facial para controle de acesso',
        content: 'Termo de consentimento biometrico. '.repeat(3),
        contentSha256: 'a'.repeat(64),
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('inventario de dispositivo', () => {
    it('cadastra hardware homologado', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/devices')
        .set('Cookie', conta.cookie)
        .send({
          gymUnitId: conta.gymUnitId,
          kind: 'FACIAL_READER',
          model: 'Inner Fit',
          serial: `SER-OK-${sufixo}`,
        });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ model: 'Inner Fit', status: 'ACTIVE' });
    });

    it('recusa hardware nao homologado com codigo estavel, nao 500', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/devices')
        .set('Cookie', conta.cookie)
        .send({
          gymUnitId: conta.gymUnitId,
          kind: 'FACIAL_READER',
          model: 'Leitor Generico Chines',
          serial: `SER-NAO-${sufixo}`,
        });

      // Quem instala precisa saber que o modelo nao passou pela bancada, e
      // nao que "deu erro no servidor".
      expect(resposta.status).toBe(400);
      expect(resposta.body).toMatchObject({ code: 'DEVICE_UNSUPPORTED_HARDWARE' });
    });

    it('recusa serial repetido no tenant', async () => {
      const serial = `SER-DUP-${sufixo}`;

      await criarDispositivo(serial);

      const repetido = await request(servidor())
        .post('/api/v1/devices')
        .set('Cookie', conta.cookie)
        .send({
          gymUnitId: conta.gymUnitId,
          kind: 'FACIAL_READER',
          model: 'Inner Fit',
          serial,
        });

      expect(repetido.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('criacao de identidade', () => {
    it('recusa upload sem consentimento (INV-017)', async () => {
      const alunoId = await criarAluno();

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-identities/upload`)
        .set('Cookie', conta.cookie)
        .send({ gymUnitId: conta.gymUnitId, contentType: 'image/jpeg' });

      // Checar so na criacao deixaria foto de quem nunca consentiu parada no
      // bucket.
      expect(resposta.status).toBe(400);
      expect(resposta.body).toMatchObject({ code: 'CONSENT_MISSING' });
    });

    it('recusa criacao para quem recusou a biometria', async () => {
      const alunoId = await criarAluno();

      await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-consent`)
        .set('Cookie', conta.cookie)
        .send({ decision: 'REFUSED' });

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-identities/upload`)
        .set('Cookie', conta.cookie)
        .send({ gymUnitId: conta.gymUnitId, contentType: 'image/jpeg' });

      expect(resposta.status).toBe(400);
      expect(resposta.body).toMatchObject({ code: 'CONSENT_REFUSED' });
    });

    it('cria identidade e um job de sync por dispositivo (INV-024)', async () => {
      const alunoId = await criarAluno();
      await aceitarConsentimento(alunoId);

      await criarDispositivo(`SER-A-${sufixo}`);
      await criarDispositivo(`SER-B-${sufixo}`);

      const { id, resposta } = await criarIdentidade(alunoId);

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ state: 'ACTIVE' });

      const jobs = await db.deviceSyncJob.findMany({ where: { identityId: id } });

      // Ha pelo menos os dois dispositivos criados aqui; o protocolo facial
      // nao tem lote (INV-023), entao um job por dispositivo.
      expect(jobs.length).toBeGreaterThanOrEqual(2);
      expect(jobs.every((j) => j.operation === 'UPSERT')).toBe(true);
      expect(new Set(jobs.map((j) => j.deviceId)).size).toBe(jobs.length);
    });

    it('nunca devolve a chave do objeto nem URL de imagem (INV-022)', async () => {
      const alunoId = await criarAluno();
      await aceitarConsentimento(alunoId);
      await criarDispositivo(`SER-C-${sufixo}`);

      const { resposta } = await criarIdentidade(alunoId);
      const corpo = JSON.stringify(resposta.body);

      // A chave tem a forma `tenants/{id}/biometrics/{id}/enrollment`; o
      // que nao pode sair e o CAMINHO, nao a palavra. `hasEnrollmentObject`
      // e justamente o substituto dela.
      expect(corpo).not.toMatch(/tenants\//);
      expect(corpo).not.toMatch(/biometrics\//);
      expect(corpo).not.toMatch(/https?:\/\//);
      expect(resposta.body).not.toHaveProperty('enrollmentObjectKey');
      // O que a UI precisa saber e se ha objeto, nao onde ele esta.
      expect(resposta.body).toMatchObject({ hasEnrollmentObject: true });
    });

    it('recusa segunda identidade ativa para o mesmo aluno', async () => {
      const alunoId = await criarAluno();
      await aceitarConsentimento(alunoId);
      await criarDispositivo(`SER-D-${sufixo}`);

      await criarIdentidade(alunoId);
      const { resposta } = await criarIdentidade(alunoId);

      // Duas biometrias vivas fariam a revogacao de uma nao bloquear a outra.
      expect(resposta.status).toBe(400);
      expect(resposta.body).toMatchObject({ code: 'BIOMETRIC_IDENTITY_ALREADY_ACTIVE' });
    });

    it('recusa criacao quando o objeto nao chegou ao storage', async () => {
      const alunoId = await criarAluno();
      await aceitarConsentimento(alunoId);
      await criarDispositivo(`SER-E-${sufixo}`);

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-identities`)
        .set('Cookie', conta.cookie)
        // Token que o storage falso reporta como ausente.
        .send({ gymUnitId: conta.gymUnitId, uploadToken: 'ausente' });

      // O cliente diz que enviou; isto verifica.
      expect(resposta.status).toBe(400);
      expect(resposta.body).toMatchObject({ code: 'BIOMETRIC_ENROLLMENT_OBJECT_MISSING' });
    });

    it('recusa objeto de zero byte', async () => {
      const alunoId = await criarAluno();
      await aceitarConsentimento(alunoId);
      await criarDispositivo(`SER-F-${sufixo}`);

      const resposta = await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-identities`)
        .set('Cookie', conta.cookie)
        .send({ gymUnitId: conta.gymUnitId, uploadToken: 'vazio' });

      expect(resposta.status).toBe(400);
      expect(resposta.body).toMatchObject({ code: 'BIOMETRIC_ENROLLMENT_OBJECT_EMPTY' });
    });

    it('registra o acesso a imagem de cadastro (ADR-008)', async () => {
      const alunoId = await criarAluno();
      await aceitarConsentimento(alunoId);

      await request(servidor())
        .post(`/api/v1/students/${alunoId}/biometric-identities/upload`)
        .set('Cookie', conta.cookie)
        .send({ gymUnitId: conta.gymUnitId, contentType: 'image/jpeg' });

      const acessos = await db.biometricAccessLog.findMany({
        where: { tenantId: conta.tenantId, kind: 'ENROLLMENT_IMAGE' },
      });

      // Falha no controle de acesso as imagens foi uma das tres causas da
      // suspensao da ANPD no caso PR.
      expect(acessos.length).toBeGreaterThan(0);
      expect(acessos[0]?.purpose).toBe('ENROLLMENT');
      expect(acessos[0]?.actorId).not.toBeNull();
    });
  });

  describe('revogacao (INV-018, INV-019)', () => {
    it('bloqueia logicamente no commit, com exclusao fisica pendente', async () => {
      const alunoId = await criarAluno();
      await aceitarConsentimento(alunoId);
      await criarDispositivo(`SER-G-${sufixo}`);

      const { id } = await criarIdentidade(alunoId);

      const resposta = await request(servidor())
        .delete(`/api/v1/students/${alunoId}/biometric-identities/${id}`)
        .set('Cookie', conta.cookie)
        .send({ reason: 'pedido do titular', confirm: true });

      expect(resposta.status).toBe(200);
      // DELETION_PENDING, nao DELETED: os leitores ainda nao confirmaram.
      // Dizer "excluido" agora seria mentir na tela de auditoria.
      expect(resposta.body).toMatchObject({ state: 'DELETION_PENDING' });

      const identidade = await db.biometricIdentity.findUnique({ where: { id } });

      // Ja nao autoriza nada, mesmo com exclusao fisica pendente.
      expect(identidade?.state).not.toBe('ACTIVE');
      expect(identidade?.revokedAt).not.toBeNull();
    });

    it('cria um job DELETE por dispositivo onde a identidade estava', async () => {
      const alunoId = await criarAluno();
      await aceitarConsentimento(alunoId);
      await criarDispositivo(`SER-H-${sufixo}`);

      const { id } = await criarIdentidade(alunoId);

      await request(servidor())
        .delete(`/api/v1/students/${alunoId}/biometric-identities/${id}`)
        .set('Cookie', conta.cookie)
        .send({ reason: 'teste', confirm: true });

      const exclusoes = await db.deviceSyncJob.findMany({
        where: { identityId: id, operation: 'DELETE' },
      });

      const cadastros = await db.deviceUser.findMany({ where: { identityId: id } });

      expect(exclusoes.length).toBe(cadastros.length);
      expect(cadastros.every((c) => c.state === 'REMOVAL_PENDING')).toBe(true);
    });

    it('NAO reescreve o consentimento ao revogar a identidade', async () => {
      const alunoId = await criarAluno();
      await aceitarConsentimento(alunoId);
      await criarDispositivo(`SER-I-${sufixo}`);

      const { id } = await criarIdentidade(alunoId);

      await request(servidor())
        .delete(`/api/v1/students/${alunoId}/biometric-identities/${id}`)
        .set('Cookie', conta.cookie)
        .send({ reason: 'teste', confirm: true });

      const consentimento = await db.consentRecord.findFirst({
        where: { tenantId: conta.tenantId, studentId: alunoId },
        orderBy: { occurredAt: 'desc' },
      });

      // Apagar uma identidade nao apaga a decisao que a autorizou -- sao
      // fatos distintos, e o segundo e prova.
      expect(consentimento?.decision).toBe('ACCEPTED');
    });

    it('exige confirmacao explicita', async () => {
      const alunoId = await criarAluno();
      await aceitarConsentimento(alunoId);
      await criarDispositivo(`SER-J-${sufixo}`);

      const { id } = await criarIdentidade(alunoId);

      const resposta = await request(servidor())
        .delete(`/api/v1/students/${alunoId}/biometric-identities/${id}`)
        .set('Cookie', conta.cookie)
        .send({ reason: 'sem confirmar' });

      // Revogar apaga biometria de equipamento fisico: nao acontece por
      // clique acidental.
      expect(resposta.status).toBe(400);
    });

    it('revogar duas vezes nao refaz o fan-out', async () => {
      const alunoId = await criarAluno();
      await aceitarConsentimento(alunoId);
      await criarDispositivo(`SER-K-${sufixo}`);

      const { id } = await criarIdentidade(alunoId);

      const primeira = await request(servidor())
        .delete(`/api/v1/students/${alunoId}/biometric-identities/${id}`)
        .set('Cookie', conta.cookie)
        .send({ reason: 'primeira', confirm: true });

      const segunda = await request(servidor())
        .delete(`/api/v1/students/${alunoId}/biometric-identities/${id}`)
        .set('Cookie', conta.cookie)
        .send({ reason: 'segunda', confirm: true });

      expect(primeira.status).toBe(200);
      // So ACTIVE transiciona: a segunda nao encontra identidade a revogar.
      expect(segunda.status).toBe(404);
    });
  });
});
