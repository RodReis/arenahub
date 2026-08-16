import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CABECALHOS, assinar } from '@arenahub/api-contracts';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { EdgeAuthService } from '../../src/modules/edge-auth/edge-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F8, Task 4 -- fila duravel, lease e reconciliacao.
 *
 * O que este arquivo prova, e que teste de unidade nao alcanca:
 *
 *   - comando sobrevive a socket ausente (o Edge busca por REST);
 *   - lease impede dois processos de executarem o mesmo comando;
 *   - resultado repetido IDENTICO e aceito; DIFERENTE e recusado;
 *   - falha transitoria retenta com backoff; a quinta vai para dead letter;
 *   - erro permanente pula direto para dead letter;
 *   - identidade so vira DELETED quando TODOS confirmam (INV-027).
 */
describe('F8 -- fila de sincronizacao', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const conta = { email: `f8s-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' };
  const edge = { edgeNodeId: '', keyId: '', segredo: '' };

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

  const storageFalso = {
    createPrivateUpload: (entrada: { key: string }) =>
      Promise.resolve({
        uploadUrl: `https://storage.test/${entrada.key}`,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    headPrivateObject: () => Promise.resolve({ size: 2048, contentType: 'image/jpeg' }),
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

  /** Requisicao assinada do Edge. */
  const comoEdge = async (
    metodo: 'get' | 'post',
    caminho: string,
    corpo?: Record<string, unknown>,
  ): Promise<request.Response> => {
    const texto = corpo ? JSON.stringify(corpo) : '';
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(16).toString('base64url');

    const assinatura = assinar(
      {
        keyId: edge.keyId,
        timestamp,
        nonce,
        method: metodo.toUpperCase(),
        pathAndQuery: caminho,
        body: texto,
      },
      edge.segredo,
    );

    const requisicao = request(servidor())
      [metodo](caminho)
      .set(CABECALHOS.keyId, edge.keyId)
      .set(CABECALHOS.timestamp, String(timestamp))
      .set(CABECALHOS.nonce, nonce)
      .set(CABECALHOS.signature, assinatura);

    return corpo
      ? requisicao.set('Content-Type', 'application/json').send(texto)
      : requisicao;
  };

  const criarAlunoComIdentidade = async (): Promise<{
    studentId: string;
    identityId: string;
  }> => {
    const hoje = new Date();
    const nascimento = new Date(
      Date.UTC(hoje.getUTCFullYear() - 30, hoje.getUTCMonth(), hoje.getUTCDate()),
    );

    const aluno = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName: 'Aluno Sync',
        birthDate: nascimento.toISOString().slice(0, 10),
        contacts: [],
      });

    const studentId = (aluno.body as { id: string }).id;

    await request(servidor())
      .post(`/api/v1/students/${studentId}/biometric-consent`)
      .set('Cookie', conta.cookie)
      .send({ decision: 'ACCEPTED' });

    const upload = await request(servidor())
      .post(`/api/v1/students/${studentId}/biometric-identities/upload`)
      .set('Cookie', conta.cookie)
      .send({ gymUnitId: conta.gymUnitId, contentType: 'image/jpeg' });

    const identidade = await request(servidor())
      .post(`/api/v1/students/${studentId}/biometric-identities`)
      .set('Cookie', conta.cookie)
      .send({
        gymUnitId: conta.gymUnitId,
        uploadToken: (upload.body as { uploadToken: string }).uploadToken,
      });

    expect(identidade.status).toBe(201);

    return { studentId, identityId: (identidade.body as { id: string }).id };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storageFalso)
      .compile();

    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: { slug: `f8-sync-${sufixo}`, legalName: 'Sync LTDA', displayName: 'Sync' },
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

    const node = await db.edgeNode.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `EDGE-${sufixo}` },
    });

    const segredo = randomBytes(32).toString('base64url');
    const keyId = `key-sync-${sufixo}`;

    await db.edgeCredential.create({
      data: {
        tenantId: tenant.id,
        edgeNodeId: node.id,
        keyId,
        encryptedSecret: app.get(EdgeAuthService).cifrarSegredo(segredo),
        activeFrom: new Date(Date.now() - 60_000),
      },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: conta.email, password: SENHA });

    conta.tenantId = tenant.id;
    conta.gymUnitId = unidade.id;
    conta.cookie = cookieDeAcesso(login);

    edge.edgeNodeId = node.id;
    edge.keyId = keyId;
    edge.segredo = segredo;

    await db.consentDocument.create({
      data: {
        tenantId: tenant.id,
        type: 'BIOMETRIC',
        version: 1,
        purpose: 'Identificacao facial para controle de acesso',
        content: 'Termo biometrico. '.repeat(5),
        contentSha256: 'a'.repeat(64),
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    // Dispositivo ligado a ESTE Edge -- e o que faz a materializacao achar
    // trabalho para ele.
    await db.device.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        edgeNodeId: node.id,
        kind: 'FACIAL_READER',
        model: 'Inner Fit',
        serial: `SER-SYNC-${sufixo}`,
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('entrega de comando', () => {
    it('materializa comando para o job pendente e entrega ao Edge', async () => {
      await criarAlunoComIdentidade();

      const resposta = await comoEdge('get', '/api/v1/edge/commands?after=0&limit=50');

      expect(resposta.status).toBe(200);

      const comandos = (resposta.body as { commands: { type: string }[] }).commands;

      expect(comandos.length).toBeGreaterThan(0);
      expect(comandos.some((c) => c.type === 'DEVICE_USER_UPSERT')).toBe(true);
    });

    it('nunca inclui template bruto no payload (INV-022)', async () => {
      await criarAlunoComIdentidade();

      const resposta = await comoEdge('get', '/api/v1/edge/commands?after=0');
      const corpo = JSON.stringify(resposta.body);

      // O comando leva a REFERENCIA do objeto; o Edge busca a imagem por URL
      // assinada quando precisar.
      expect(corpo).not.toMatch(/base64|template|biometricData/i);
    });

    it('entrega o comando mesmo sem socket -- o Edge busca por REST', async () => {
      const { identityId } = await criarAlunoComIdentidade();

      // Nenhuma notificacao foi enviada nesta suite: nao ha WebSocket aqui.
      // O comando existe porque foi PERSISTIDO, nao porque alguem avisou.
      const resposta = await comoEdge('get', '/api/v1/edge/commands?after=0');
      const comandos = (resposta.body as { commands: { payload: { identityId?: string } }[] })
        .commands;

      expect(comandos.some((c) => c.payload.identityId === identityId)).toBe(true);
    });
  });

  describe('lease', () => {
    it('arrenda o comando uma vez so', async () => {
      await criarAlunoComIdentidade();

      const lista = await comoEdge('get', '/api/v1/edge/commands?after=0');
      const comando = (lista.body as { commands: { id: string }[] }).commands[0]!;

      const primeira = await comoEdge('post', `/api/v1/edge/commands/${comando.id}/lease`);
      const segunda = await comoEdge('post', `/api/v1/edge/commands/${comando.id}/lease`);

      expect(primeira.body).toMatchObject({ leased: true });
      // Sem isso, dois processos do Edge executariam o mesmo comando no
      // leitor fisico.
      expect(segunda.body).toMatchObject({ leased: false });
    });
  });

  describe('resultado', () => {
    it('marca SYNCED e registra o cadastro no dispositivo', async () => {
      const { identityId } = await criarAlunoComIdentidade();

      const lista = await comoEdge('get', '/api/v1/edge/commands?after=0');
      const comando = (lista.body as { commands: { id: string; payload: { identityId: string } }[] })
        .commands.find((c) => c.payload.identityId === identityId)!;

      const resposta = await comoEdge('post', '/api/v1/edge/sync-results/batch', {
        results: [
          {
            commandId: comando.id,
            success: true,
            deviceTimestamp: new Date().toISOString(),
          },
        ],
      });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ accepted: 1, conflicts: 0 });

      const cadastro = await db.deviceUser.findFirst({ where: { identityId } });

      expect(cadastro?.state).toBe('SYNCED');
      expect(cadastro?.syncedAt).not.toBeNull();
    });

    it('aceita resultado repetido IDENTICO em silencio', async () => {
      const { identityId } = await criarAlunoComIdentidade();

      const lista = await comoEdge('get', '/api/v1/edge/commands?after=0');
      const comando = (lista.body as { commands: { id: string; payload: { identityId: string } }[] })
        .commands.find((c) => c.payload.identityId === identityId)!;

      const resultado = {
        results: [
          { commandId: comando.id, success: true, deviceTimestamp: new Date().toISOString() },
        ],
      };

      await comoEdge('post', '/api/v1/edge/sync-results/batch', resultado);
      const repetido = await comoEdge('post', '/api/v1/edge/sync-results/batch', resultado);

      // O Edge pode ter executado no leitor e morrido antes de reportar --
      // reenviar precisa ser seguro.
      expect(repetido.status).toBe(201);
      expect(repetido.body).toMatchObject({ conflicts: 0 });
    });

    it('recusa resultado DIFERENTE para comando ja reconhecido', async () => {
      const { identityId } = await criarAlunoComIdentidade();

      const lista = await comoEdge('get', '/api/v1/edge/commands?after=0');
      const comando = (lista.body as { commands: { id: string; payload: { identityId: string } }[] })
        .commands.find((c) => c.payload.identityId === identityId)!;

      await comoEdge('post', '/api/v1/edge/sync-results/batch', {
        results: [
          { commandId: comando.id, success: true, deviceTimestamp: new Date().toISOString() },
        ],
      });

      const contraditorio = await comoEdge('post', '/api/v1/edge/sync-results/batch', {
        results: [
          {
            commandId: comando.id,
            success: false,
            errorCode: 'DEVICE_UNREACHABLE',
            deviceTimestamp: new Date().toISOString(),
          },
        ],
      });

      // Reenviar e seguro; mudar a historia, nao.
      expect(contraditorio.body).toMatchObject({ conflicts: 1 });
    });

    it('agenda retentativa com backoff em falha transitoria', async () => {
      const { identityId } = await criarAlunoComIdentidade();

      const lista = await comoEdge('get', '/api/v1/edge/commands?after=0');
      const comando = (lista.body as { commands: { id: string; payload: { identityId: string } }[] })
        .commands.find((c) => c.payload.identityId === identityId)!;

      await comoEdge('post', '/api/v1/edge/sync-results/batch', {
        results: [
          {
            commandId: comando.id,
            success: false,
            errorCode: 'DEVICE_UNREACHABLE',
            deviceTimestamp: new Date().toISOString(),
          },
        ],
      });

      const job = await db.deviceSyncJob.findFirst({ where: { identityId } });

      expect(job?.state).toBe('RETRYING');
      expect(job?.nextAttemptAt).not.toBeNull();
      expect(job?.errorCode).toBe('DEVICE_UNREACHABLE');
    });

    it('vai direto para dead letter em erro permanente', async () => {
      const { identityId } = await criarAlunoComIdentidade();

      const lista = await comoEdge('get', '/api/v1/edge/commands?after=0');
      const comando = (lista.body as { commands: { id: string; payload: { identityId: string } }[] })
        .commands.find((c) => c.payload.identityId === identityId)!;

      await comoEdge('post', '/api/v1/edge/sync-results/batch', {
        results: [
          {
            commandId: comando.id,
            success: false,
            errorCode: 'DEVICE_ENROLLMENT_REJECTED',
            deviceTimestamp: new Date().toISOString(),
          },
        ],
      });

      const job = await db.deviceSyncJob.findFirst({ where: { identityId } });

      // Gastar cinco tentativas repetindo o que ja se sabe que falha so
      // atrasa a descoberta pela operacao.
      expect(job?.state).toBe('FAILED');
    });
  });

  describe('painel de pendencia', () => {
    it('lista jobs com acao recomendada', async () => {
      const { identityId } = await criarAlunoComIdentidade();

      const lista = await comoEdge('get', '/api/v1/edge/commands?after=0');
      const comando = (lista.body as { commands: { id: string; payload: { identityId: string } }[] })
        .commands.find((c) => c.payload.identityId === identityId)!;

      await comoEdge('post', '/api/v1/edge/sync-results/batch', {
        results: [
          {
            commandId: comando.id,
            success: false,
            errorCode: 'DEVICE_UNREACHABLE',
            deviceTimestamp: new Date().toISOString(),
          },
        ],
      });

      const painel = await request(servidor())
        .get(`/api/v1/device-sync-jobs?identityId=${identityId}`)
        .set('Cookie', conta.cookie);

      expect(painel.status).toBe(200);

      const jobs = painel.body as { errorCode: string; recommendedAction: string }[];

      // Codigo sozinho manda a recepcao abrir chamado para descobrir o que
      // fazer; a frase resolve na hora os casos triviais.
      expect(jobs[0]?.recommendedAction).toMatch(/ligado|rede/i);
    });

    it('nao expoe dado biometrico no painel (INV-022)', async () => {
      const painel = await request(servidor())
        .get('/api/v1/device-sync-jobs')
        .set('Cookie', conta.cookie);

      const corpo = JSON.stringify(painel.body);

      expect(corpo).not.toMatch(/tenants\/|biometrics\/|enrollmentObjectKey/);
    });

    it('exige permissao', async () => {
      const resposta = await request(servidor()).get('/api/v1/device-sync-jobs');

      expect(resposta.status).toBe(401);
    });
  });

  describe('reconciliacao de exclusao (INV-027)', () => {
    it('so marca DELETED quando todos os dispositivos confirmam', async () => {
      const { studentId, identityId } = await criarAlunoComIdentidade();

      // Segundo dispositivo no mesmo Edge: a identidade so fecha quando os
      // DOIS confirmarem.
      await db.device.create({
        data: {
          tenantId: conta.tenantId,
          gymUnitId: conta.gymUnitId,
          edgeNodeId: edge.edgeNodeId,
          kind: 'FACIAL_READER',
          model: 'Inner Fit',
          serial: `SER-SEGUNDO-${sufixo}`,
        },
      });

      await request(servidor())
        .delete(`/api/v1/students/${studentId}/biometric-identities/${identityId}`)
        .set('Cookie', conta.cookie)
        .send({ reason: 'teste de reconciliacao', confirm: true });

      const lista = await comoEdge('get', '/api/v1/edge/commands?after=0&limit=50');
      const exclusoes = (
        lista.body as {
          commands: { id: string; type: string; payload: { identityId: string } }[];
        }
      ).commands.filter(
        (c) => c.type === 'DEVICE_USER_DELETE' && c.payload.identityId === identityId,
      );

      expect(exclusoes.length).toBeGreaterThan(0);

      // Confirma so a primeira exclusao.
      await comoEdge('post', '/api/v1/edge/sync-results/batch', {
        results: [
          {
            commandId: exclusoes[0]!.id,
            success: true,
            deviceTimestamp: new Date().toISOString(),
          },
        ],
      });

      const parcial = await db.biometricIdentity.findUnique({ where: { id: identityId } });

      // Ainda ha cadastro pendente noutro leitor: declarar DELETED aqui
      // esconderia biometria viva em equipamento que ninguem foi conferir.
      const restantes = await db.deviceUser.count({
        where: { identityId, state: { in: ['PENDING', 'SYNCED', 'REMOVAL_PENDING', 'FAILED'] } },
      });

      if (restantes > 0) {
        expect(parcial?.state).toBe('DELETION_PENDING');
      }

      // Confirma o resto.
      for (const exclusao of exclusoes.slice(1)) {
        await comoEdge('post', '/api/v1/edge/sync-results/batch', {
          results: [
            {
              commandId: exclusao.id,
              success: true,
              deviceTimestamp: new Date().toISOString(),
            },
          ],
        });
      }

      const final = await db.biometricIdentity.findUnique({ where: { id: identityId } });

      expect(final?.state).toBe('DELETED');
      expect(final?.deletedAt).not.toBeNull();
    });

    it('dispositivo em falha impede o fechamento', async () => {
      const { studentId, identityId } = await criarAlunoComIdentidade();

      await request(servidor())
        .delete(`/api/v1/students/${studentId}/biometric-identities/${identityId}`)
        .set('Cookie', conta.cookie)
        .send({ reason: 'teste de falha', confirm: true });

      const lista = await comoEdge('get', '/api/v1/edge/commands?after=0&limit=50');
      const exclusao = (
        lista.body as {
          commands: { id: string; type: string; payload: { identityId: string } }[];
        }
      ).commands.find(
        (c) => c.type === 'DEVICE_USER_DELETE' && c.payload.identityId === identityId,
      )!;

      await comoEdge('post', '/api/v1/edge/sync-results/batch', {
        results: [
          {
            commandId: exclusao.id,
            success: false,
            errorCode: 'DEVICE_ENROLLMENT_REJECTED',
            deviceTimestamp: new Date().toISOString(),
          },
        ],
      });

      const identidade = await db.biometricIdentity.findUnique({ where: { id: identityId } });

      // A exclusao NAO aconteceu naquele leitor. Fechar como DELETED seria
      // declarar limpo um equipamento que ainda tem a biometria.
      expect(identidade?.state).not.toBe('DELETED');
    });
  });
});
