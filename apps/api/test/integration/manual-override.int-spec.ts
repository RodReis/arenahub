import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F9, Task 5 -- liberacao manual auditada.
 *
 * O que este arquivo prova, e que e a razao do `M1-BR-007` existir:
 *
 *   **override NAO altera assinatura nem entitlement.**
 *
 * A garantia comeca no schema (`ManualAccessOverride` nao tem coluna para
 * nenhum dos dois) e termina aqui: um teste que fotografa o estado do aluno
 * ANTES e DEPOIS, e exige que nada tenha mudado.
 */
describe('F9 -- liberacao manual', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-do-override';

  const ctx = {
    tenantId: '',
    gymUnitId: '',
    outraUnidadeId: '',
    deviceId: '',
    edgeNodeId: '',
    studentId: '',
    cookieComPermissao: '',
    cookieSemPermissao: '',
  };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  const pedirOverride = (
    sobrescreve: Record<string, unknown> = {},
    cookie = ctx.cookieComPermissao,
  ): Promise<request.Response> =>
    request(servidor())
      .post('/api/v1/access/manual-overrides')
      .set('Cookie', cookie)
      .send({
        gymUnitId: ctx.gymUnitId,
        studentId: ctx.studentId,
        deviceId: ctx.deviceId,
        reason: 'catraca travou e o aluno estava com pressa',
        idempotencyKey: `ovr-${randomUUID()}`,
        confirm: true,
        ...sobrescreve,
      });

  const criarUsuario = async (
    email: string,
    permissoes: string[],
    nomeDoPapel: string,
  ): Promise<string> => {
    const usuario = await db.user.create({
      data: { email, passwordHash: await app.get(PasswordService).gerarHash(SENHA) },
    });

    await db.tenantMembership.create({
      data: { tenantId: ctx.tenantId, userId: usuario.id },
    });

    const papel = await db.role.create({
      data: { tenantId: ctx.tenantId, name: nomeDoPapel, isSystem: false },
    });

    const registros = await Promise.all(
      permissoes.map((code) =>
        db.permission.upsert({ where: { code }, create: { code }, update: {} }),
      ),
    );

    await db.rolePermission.createMany({
      data: registros.map((p) => ({ roleId: papel.id, permissionId: p.id })),
    });

    await db.userRole.create({
      data: { tenantId: ctx.tenantId, userId: usuario.id, roleId: papel.id },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email, password: SENHA });

    return cookieDeAcesso(login);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `f9-ovr-${sufixo}`,
        legalName: 'Override LTDA',
        displayName: 'Override',
      },
    });

    ctx.tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'CENTRO',
        name: 'Centro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    ctx.gymUnitId = unidade.id;

    const outra = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'BAIRRO',
        name: 'Bairro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    ctx.outraUnidadeId = outra.id;

    const node = await db.edgeNode.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `EDGE-OVR-${sufixo}` },
    });

    ctx.edgeNodeId = node.id;

    const catraca = await db.device.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        edgeNodeId: node.id,
        kind: 'TURNSTILE',
        model: 'Inner Fit',
        serial: `SER-OVR-${sufixo}`,
      },
    });

    ctx.deviceId = catraca.id;

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        membershipNumber: `MOV-${sufixo}`,
        fullName: 'Aluno Override',
        birthDate: new Date('1991-07-07T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    ctx.studentId = aluno.id;

    ctx.cookieComPermissao = await criarUsuario(
      `f9-ovr-sim-${sufixo}@exemplo.test`,
      ['access.override', 'access.read', 'student.read'],
      'RECEPCAO',
    );

    ctx.cookieSemPermissao = await criarUsuario(
      `f9-ovr-nao-${sufixo}@exemplo.test`,
      ['access.read', 'student.read'],
      'CONSULTA',
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('permissao (M1-AC-008)', () => {
    it('recusa quem tem access.read mas nao access.override', async () => {
      const resposta = await pedirOverride({}, ctx.cookieSemPermissao);

      expect(resposta.status).toBe(403);
    });

    it('recusa sem sessao', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/access/manual-overrides')
        .send({
          gymUnitId: ctx.gymUnitId,
          studentId: ctx.studentId,
          deviceId: ctx.deviceId,
          reason: 'tentativa sem autenticacao nenhuma',
          idempotencyKey: `ovr-${randomUUID()}`,
          confirm: true,
        });

      expect(resposta.status).toBe(401);
    });
  });

  describe('validacao do pedido', () => {
    it('recusa motivo curto demais para auditar', async () => {
      const resposta = await pedirOverride({ reason: 'ok' });

      expect(resposta.status).toBe(400);
    });

    it('exige confirmacao explicita', async () => {
      const resposta = await pedirOverride({ confirm: undefined });

      expect(resposta.status).toBe(400);
    });

    it('recusa pedido sem aluno nem visitante', async () => {
      const resposta = await pedirOverride({ studentId: undefined });

      expect(resposta.status).toBe(400);
    });

    it('recusa aluno E visitante ao mesmo tempo', async () => {
      const resposta = await pedirOverride({ visitorDescription: 'Visitante Fulano' });

      expect(resposta.status).toBe(400);
    });

    it('recusa dispositivo de outra unidade', async () => {
      const alheio = await db.device.create({
        data: {
          tenantId: ctx.tenantId,
          gymUnitId: ctx.outraUnidadeId,
          kind: 'TURNSTILE',
          model: 'Inner Fit',
          serial: `SER-OVR-ALHEIO-${sufixo}`,
        },
      });

      const resposta = await pedirOverride({ deviceId: alheio.id });

      expect(resposta.status).toBe(404);
    });
  });

  describe('override NAO altera entitlement nem assinatura (M1-BR-007)', () => {
    it('deixa aluno, assinaturas e direitos exatamente como estavam', async () => {
      const antesAluno = await db.student.findUniqueOrThrow({
        where: { id: ctx.studentId },
      });
      const antesAssinaturas = await db.subscription.count({
        where: { tenantId: ctx.tenantId, studentId: ctx.studentId },
      });
      const antesDireitos = await db.entitlement.count({
        where: { tenantId: ctx.tenantId, studentId: ctx.studentId },
      });

      const resposta = await pedirOverride();

      expect(resposta.status).toBe(201);

      const depoisAluno = await db.student.findUniqueOrThrow({
        where: { id: ctx.studentId },
      });

      expect(depoisAluno.status).toBe(antesAluno.status);
      expect(depoisAluno.updatedAt.toISOString()).toBe(antesAluno.updatedAt.toISOString());

      expect(
        await db.subscription.count({
          where: { tenantId: ctx.tenantId, studentId: ctx.studentId },
        }),
      ).toBe(antesAssinaturas);

      expect(
        await db.entitlement.count({
          where: { tenantId: ctx.tenantId, studentId: ctx.studentId },
        }),
      ).toBe(antesDireitos);
    });
  });

  describe('registro do override', () => {
    it('grava evento com mode OVERRIDE e razao MANUAL_OVERRIDE (ADR-024)', async () => {
      const resposta = await pedirOverride();
      const { accessEventId } = resposta.body as { accessEventId: string };

      const evento = await db.accessEvent.findUniqueOrThrow({
        where: { id: accessEventId },
      });

      expect(evento.outcome).toBe('ALLOW');
      expect(evento.mode).toBe('OVERRIDE');
      // Nao `ACTIVE_ENTITLEMENT`: o aluno nao tem direito nenhum, e afirmar
      // que tem seria mentira gravada num fato imutavel.
      expect(evento.reason).toBe('MANUAL_OVERRIDE');
      expect(evento.entitlementId).toBeNull();
      // Nasce na nuvem, sem Edge -- e o que faz o indice parcial valer.
      expect(evento.edgeNodeId).toBeNull();
    });

    it('registra o motivo, o responsavel e a auditoria', async () => {
      const motivo = 'aluno esqueceu o cadastro facial e tinha aula marcada';

      const resposta = await pedirOverride({ reason: motivo });
      const { overrideId, accessEventId } = resposta.body as {
        overrideId: string;
        accessEventId: string;
      };

      const override = await db.manualAccessOverride.findUniqueOrThrow({
        where: { id: overrideId },
      });

      expect(override.reason).toBe(motivo);
      expect(override.studentId).toBe(ctx.studentId);

      const auditoria = await db.auditLog.findFirst({
        where: { targetId: accessEventId, action: 'access.override.created' },
      });

      expect(auditoria).not.toBeNull();
      expect(auditoria?.actorId).toBe(override.actorId);
    });

    it('cria comando duravel para o Edge, deduplicado pelo evento', async () => {
      const resposta = await pedirOverride();
      const { accessEventId } = resposta.body as { accessEventId: string };

      const comando = await db.deviceCommand.findFirstOrThrow({
        where: { idempotencyKey: `override:${accessEventId}` },
      });

      expect(comando.type).toBe('ACCESS_OVERRIDE_GRANT');
      expect(comando.edgeNodeId).toBe(ctx.edgeNodeId);
      expect(comando.state).toBe('AVAILABLE');
    });

    it('aceita visitante sem aluno cadastrado', async () => {
      const resposta = await pedirOverride({
        studentId: undefined,
        visitorDescription: 'Fulano, visitante acompanhando aluno',
      });

      expect(resposta.status).toBe(201);

      const { overrideId } = resposta.body as { overrideId: string };

      const override = await db.manualAccessOverride.findUniqueOrThrow({
        where: { id: overrideId },
      });

      expect(override.studentId).toBeNull();
      expect(override.visitorDescription).toContain('Fulano');
    });
  });

  describe('idempotencia -- clique duplo nao gira a catraca duas vezes', () => {
    it('a mesma chave devolve o mesmo evento e nao cria segundo comando', async () => {
      const chave = `ovr-fixa-${randomUUID()}`;

      const primeira = await pedirOverride({ idempotencyKey: chave });
      const segunda = await pedirOverride({ idempotencyKey: chave });

      const a = primeira.body as { accessEventId: string; replayed: boolean };
      const b = segunda.body as { accessEventId: string; replayed: boolean };

      expect(a.replayed).toBe(false);
      expect(b.replayed).toBe(true);
      expect(b.accessEventId).toBe(a.accessEventId);

      const comandos = await db.deviceCommand.count({
        where: { idempotencyKey: `override:${a.accessEventId}` },
      });

      expect(comandos).toBe(1);

      const overrides = await db.manualAccessOverride.count({
        where: { accessEventId: a.accessEventId },
      });

      expect(overrides).toBe(1);
    });
  });
});
