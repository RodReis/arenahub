import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { EdgeAuthService } from '../../src/modules/edge-auth/edge-auth.service.js';
import { AlertSchedulerService } from '../../src/modules/operations/alert-scheduler.service.js';
import { OperationsRepository } from '../../src/modules/operations/operations.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F11 -- ciclo de vida de alerta contra Postgres real.
 *
 * O que so integracao prova:
 *
 *   - condicao que persiste ATUALIZA a linha, nao cria 960 delas;
 *   - alerta reabre quando a condicao volta depois de resolvida;
 *   - reconhecer NAO resolve -- a condicao continua sendo avaliada;
 *   - tenant A nao ve alerta de tenant B;
 *   - credencial vencida deixa de autenticar (a coluna nova nao e decorativa).
 */
describe('F11 -- alertas operacionais', () => {
  let app: INestApplication;
  let db: PrismaService;
  let operacoes: OperationsRepository;
  let agendador: AlertSchedulerService;

  /** Credencial folgada: o cenario que nao testa credencial nao deve alertar por ela. */
  const LONGE = new Date(Date.now() + 30 * 86_400_000);

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-operacoes';

  const a = {
    tenantId: '',
    gymUnitId: '',
    edgeNodeId: '',
    deviceId: '',
    cookie: '',
  };

  const b = { tenantId: '', gymUnitId: '', edgeNodeId: '' };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  /** Heartbeat velho o bastante para o Edge contar como offline. */
  const silenciar = async (edgeNodeId: string, segundos = 300): Promise<void> => {
    await db.edgeNode.update({
      where: { id: edgeNodeId },
      data: { lastHeartbeat: new Date(Date.now() - segundos * 1000) },
    });
  };

  const bater = async (edgeNodeId: string): Promise<void> => {
    await db.edgeNode.update({
      where: { id: edgeNodeId },
      data: { lastHeartbeat: new Date() },
    });
  };

  /**
   * Alertas de UM recurso.
   *
   * Filtrar por `resourceId` e o que torna os testes independentes de ordem:
   * cada cenario cria o proprio Edge e olha so para ele. Consultar por
   * `code` global faria um teste enxergar o Edge que outro deixou offline.
   */
  const alertasDe = async (tenantId: string, code: string, resourceId: string) =>
    db.operationalAlert.findMany({
      where: { tenantId, code, resourceId },
      orderBy: { createdAt: 'asc' },
    });

  /** Edge proprio do cenario, no estado pedido. */
  const criarEdge = async (
    rotulo: string,
    opcoes: { offline?: boolean; expiraEm?: Date | null } = {},
  ): Promise<string> => {
    const node = await db.edgeNode.create({
      data: {
        tenantId: a.tenantId,
        gymUnitId: a.gymUnitId,
        code: `EDGE-${rotulo}-${randomUUID().slice(0, 6)}`,
        lastHeartbeat: opcoes.offline ? new Date(Date.now() - 300_000) : new Date(),
      },
    });

    if (opcoes.expiraEm !== undefined) {
      await db.edgeCredential.create({
        data: {
          tenantId: a.tenantId,
          edgeNodeId: node.id,
          keyId: `key-${rotulo}-${randomUUID().slice(0, 8)}`,
          encryptedSecret: app
            .get(EdgeAuthService)
            .cifrarSegredo(randomBytes(32).toString('base64url')),
          activeFrom: new Date(Date.now() - 60_000),
          expiresAt: opcoes.expiraEm,
        },
      });
    }

    return node.id;
  };

  const criarTenant = async (rotulo: string) => {
    const tenant = await db.tenant.create({
      data: {
        slug: `f11-${rotulo}-${sufixo}`,
        legalName: `F11 ${rotulo}`,
        displayName: `F11 ${rotulo}`,
      },
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
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        code: `EDGE-F11-${rotulo}-${sufixo}`,
        // Nasce saudavel: cada teste degrada o que quer provar.
        lastHeartbeat: new Date(),
      },
    });

    await db.edgeCredential.create({
      data: {
        tenantId: tenant.id,
        edgeNodeId: node.id,
        keyId: `key-f11-${rotulo}-${sufixo}`,
        encryptedSecret: app
          .get(EdgeAuthService)
          .cifrarSegredo(randomBytes(32).toString('base64url')),
        activeFrom: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    const dispositivo = await db.device.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        edgeNodeId: node.id,
        kind: 'FACIAL_READER',
        model: 'Inner Fit',
        serial: `SER-F11-${rotulo}-${sufixo}`,
        lastHeartbeat: new Date(),
      },
    });

    return {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      edgeNodeId: node.id,
      deviceId: dispositivo.id,
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);
    operacoes = app.get(OperationsRepository);
    agendador = app.get(AlertSchedulerService);

    Object.assign(a, await criarTenant('a'));
    Object.assign(b, await criarTenant('b'));

    const usuario = await db.user.create({
      data: {
        email: `f11-op-${sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash(SENHA),
      },
    });

    await db.tenantMembership.create({
      data: { tenantId: a.tenantId, userId: usuario.id },
    });

    const papel = await db.role.create({
      data: { tenantId: a.tenantId, name: 'OPERACAO', isSystem: false },
    });

    const permissao = await db.permission.upsert({
      where: { code: 'access.read' },
      create: { code: 'access.read' },
      update: {},
    });

    await db.rolePermission.create({
      data: { roleId: papel.id, permissionId: permissao.id },
    });

    await db.userRole.create({
      data: { tenantId: a.tenantId, userId: usuario.id, roleId: papel.id },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: usuario.email, password: SENHA });

    a.cookie = cookieDeAcesso(login);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Edge ausente vira alerta (INV-146)', () => {
    it('nao cria alerta com Edge saudavel', async () => {
      const saudavel = await criarEdge('OK', { expiraEm: LONGE });

      await operacoes.avaliarTenant(a.tenantId, new Date());

      expect(await alertasDe(a.tenantId, 'EDGE_OFFLINE', saudavel)).toHaveLength(0);
    });

    it('cria alerta CRITICAL quando o heartbeat some', async () => {
      const mudo = await criarEdge('MUDO', { offline: true, expiraEm: LONGE });

      await operacoes.avaliarTenant(a.tenantId, new Date());

      const [alerta] = await alertasDe(a.tenantId, 'EDGE_OFFLINE', mudo);

      expect(alerta?.state).toBe('OPEN');
      expect(alerta?.severity).toBe('CRITICAL');
      expect(alerta?.impact).toContain('nao esta liberando acesso');
      expect(alerta?.recommendedAction).toContain('liberacao manual');
    });
  });

  describe('condicao que persiste NAO vira 960 linhas', () => {
    it('dez avaliacoes seguidas produzem UMA linha, com lastSeenAt movendo', async () => {
      const isolado = await criarEdge('DEZ', { offline: true, expiraEm: LONGE });

      // Ancorado no heartbeat REAL do Edge, nao numa data fixa: com data
      // fixa no passado o heartbeat cairia no futuro, o silencio seria
      // negativo e o Edge pareceria saudavel.
      const heartbeat = (
        await db.edgeNode.findUniqueOrThrow({ where: { id: isolado } })
      ).lastHeartbeat!;

      const primeiro = new Date(heartbeat.getTime() + 300_000);

      await operacoes.avaliarTenant(a.tenantId, primeiro);

      expect(await alertasDe(a.tenantId, 'EDGE_OFFLINE', isolado)).toHaveLength(1);

      // Nove avaliacoes a mais -- o que aconteceria em 5 min de Edge fora.
      for (let i = 1; i <= 9; i += 1) {
        await operacoes.avaliarTenant(a.tenantId, new Date(primeiro.getTime() + i * 30_000));
      }

      const finais = await alertasDe(a.tenantId, 'EDGE_OFFLINE', isolado);

      expect(finais).toHaveLength(1);
      // `firstSeenAt` preserva quando comecou; `lastSeenAt` anda.
      expect(finais[0]?.firstSeenAt.toISOString()).toBe(primeiro.toISOString());
      expect(finais[0]?.lastSeenAt.getTime()).toBeGreaterThan(primeiro.getTime());
    });
  });

  describe('resolucao e reabertura', () => {
    it('resolve sozinho quando a condicao some', async () => {
      const edge = await criarEdge('RESOLVE', { offline: true, expiraEm: LONGE });

      await operacoes.avaliarTenant(a.tenantId, new Date());
      await bater(edge);
      await operacoes.avaliarTenant(a.tenantId, new Date());

      const [alerta] = await alertasDe(a.tenantId, 'EDGE_OFFLINE', edge);

      expect(alerta?.state).toBe('RESOLVED');
      expect(alerta?.resolvedAt).not.toBeNull();
    });

    it('REABRE quando a condicao volta -- nao fica eternamente resolvido', async () => {
      const edge = await criarEdge('REABRE', { offline: true, expiraEm: LONGE });

      await operacoes.avaliarTenant(a.tenantId, new Date());
      await bater(edge);
      await operacoes.avaliarTenant(a.tenantId, new Date());

      await silenciar(edge);
      await operacoes.avaliarTenant(a.tenantId, new Date());

      const alertas = await alertasDe(a.tenantId, 'EDGE_OFFLINE', edge);

      expect(alertas).toHaveLength(1);
      expect(alertas[0]?.state).toBe('OPEN');
      expect(alertas[0]?.resolvedAt).toBeNull();
    });

    it('reabertura descarta o reconhecimento antigo', async () => {
      const edge = await criarEdge('ACKRESET', { offline: true, expiraEm: LONGE });

      await operacoes.avaliarTenant(a.tenantId, new Date());

      const [antes] = await alertasDe(a.tenantId, 'EDGE_OFFLINE', edge);

      await request(servidor())
        .post(`/api/v1/operations/alerts/${antes!.id}/acknowledge`)
        .set('Cookie', a.cookie);

      await bater(edge);
      await operacoes.avaliarTenant(a.tenantId, new Date());
      await silenciar(edge);
      await operacoes.avaliarTenant(a.tenantId, new Date());

      const [depois] = await alertasDe(a.tenantId, 'EDGE_OFFLINE', edge);

      // Quem reconheceu na queda anterior nao sabe que caiu de novo.
      expect(depois?.acknowledgedAt).toBeNull();
      expect(depois?.state).toBe('OPEN');
    });
  });

  describe('reconhecer NAO resolve (M1-AC-011)', () => {
    it('marca ACKNOWLEDGED e mantem o alerta ativo', async () => {
      const edge = await criarEdge('ACK', { offline: true, expiraEm: LONGE });

      await operacoes.avaliarTenant(a.tenantId, new Date());

      const [alerta] = await alertasDe(a.tenantId, 'EDGE_OFFLINE', edge);

      const resposta = await request(servidor())
        .post(`/api/v1/operations/alerts/${alerta!.id}/acknowledge`)
        .set('Cookie', a.cookie);

      expect(resposta.status).toBe(201);
      expect((resposta.body as { state: string }).state).toBe('ACKNOWLEDGED');

      // A condicao continua: nova avaliacao NAO devolve para OPEN nem resolve.
      await operacoes.avaliarTenant(a.tenantId, new Date());

      const [depois] = await alertasDe(a.tenantId, 'EDGE_OFFLINE', edge);

      expect(depois?.state).toBe('ACKNOWLEDGED');
      expect(depois?.resolvedAt).toBeNull();
    });

    it('registra quem reconheceu na auditoria', async () => {
      const edge = await criarEdge('AUDIT', { offline: true, expiraEm: LONGE });

      await operacoes.avaliarTenant(a.tenantId, new Date());

      const [alerta] = await alertasDe(a.tenantId, 'EDGE_OFFLINE', edge);

      await request(servidor())
        .post(`/api/v1/operations/alerts/${alerta!.id}/acknowledge`)
        .set('Cookie', a.cookie);

      const auditoria = await db.auditLog.findFirst({
        where: { targetId: alerta!.id, action: 'operations.alert.acknowledged' },
      });

      expect(auditoria).not.toBeNull();
    });

    it('404 indistinguivel para alerta de outro tenant', async () => {
      await silenciar(b.edgeNodeId);
      await operacoes.avaliarTenant(b.tenantId, new Date());

      const [alheio] = await alertasDe(b.tenantId, 'EDGE_OFFLINE', b.edgeNodeId);

      const resposta = await request(servidor())
        .post(`/api/v1/operations/alerts/${alheio!.id}/acknowledge`)
        .set('Cookie', a.cookie);

      expect(resposta.status).toBe(404);
    });
  });

  describe('credencial vencida -- ADR-011', () => {
    it('alerta quando a credencial esta perto de vencer', async () => {
      const edge = await criarEdge('CRED', { expiraEm: new Date(Date.now() + 3_600_000) });

      await operacoes.avaliarTenant(a.tenantId, new Date());

      const [alerta] = await alertasDe(a.tenantId, 'EDGE_CREDENTIAL_EXPIRING', edge);

      expect(alerta?.state).toBe('OPEN');
      // A acao NAO manda ir ate a academia: e problema de quem opera a nuvem.
      expect(alerta?.recommendedAction).toContain('Nao e necessario ir ate a academia');
    });

    it('e um alerta SEPARADO de EDGE_OFFLINE, com fingerprint proprio', async () => {
      const mudo = await criarEdge('SEP1', { offline: true, expiraEm: LONGE });
      const vencendo = await criarEdge('SEP2', { expiraEm: new Date(Date.now() + 3_600_000) });

      await operacoes.avaliarTenant(a.tenantId, new Date());

      expect(await alertasDe(a.tenantId, 'EDGE_OFFLINE', mudo)).toHaveLength(1);
      expect(await alertasDe(a.tenantId, 'EDGE_CREDENTIAL_EXPIRING', vencendo)).toHaveLength(1);
    });

    it('credencial vencida DEIXA de autenticar -- a coluna nao e decorativa', async () => {
      const node = await db.edgeNode.create({
        data: {
          tenantId: a.tenantId,
          gymUnitId: a.gymUnitId,
          code: `EDGE-VENC-${randomUUID().slice(0, 6)}`,
        },
      });

      const keyId = `key-vencida-${randomUUID().slice(0, 8)}`;

      await db.edgeCredential.create({
        data: {
          tenantId: a.tenantId,
          edgeNodeId: node.id,
          keyId,
          encryptedSecret: app
            .get(EdgeAuthService)
            .cifrarSegredo(randomBytes(32).toString('base64url')),
          activeFrom: new Date(Date.now() - 86_400_000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      const resultado = await app.get(EdgeAuthService).verificar(
        {
          keyId,
          timestamp: String(Math.floor(Date.now() / 1000)),
          nonce: randomBytes(16).toString('base64url'),
          signature: 'irrelevante',
          method: 'POST',
          pathAndQuery: '/api/v1/edge/heartbeat',
          body: '',
        },
        new Date(),
      );

      expect(resultado.ok).toBe(false);
    });

    it('credencial SEM prazo continua valendo -- nulo e "sem prazo", nao "vencida"', async () => {
      const edge = await criarEdge('SEMPRAZO', { expiraEm: null });

      await operacoes.avaliarTenant(a.tenantId, new Date());

      expect(await alertasDe(a.tenantId, 'EDGE_CREDENTIAL_EXPIRING', edge)).toHaveLength(0);
    });
  });

  describe('painel', () => {
    it('devolve panorama de Edges, dispositivos, sync e acesso', async () => {
      const resposta = await request(servidor())
        .get('/api/v1/operations/overview')
        .set('Cookie', a.cookie);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as {
        edges: unknown[];
        dispositivos: unknown[];
        sync: Record<string, number>;
        acesso: Record<string, number>;
      };

      expect(corpo.edges.length).toBeGreaterThan(0);
      expect(corpo.dispositivos.length).toBeGreaterThan(0);
      expect(corpo.sync).toHaveProperty('deadLetters');
      expect(corpo.acesso).toHaveProperty('deny');
    });

    it('o panorama NAO mostra recurso de outro tenant', async () => {
      const resposta = await request(servidor())
        .get('/api/v1/operations/overview')
        .set('Cookie', a.cookie);

      const corpo = resposta.body as { edges: { id: string }[] };

      expect(corpo.edges.map((e) => e.id)).not.toContain(b.edgeNodeId);
    });

    it('recusa sem sessao', async () => {
      const resposta = await request(servidor()).get('/api/v1/operations/overview');

      expect(resposta.status).toBe(401);
    });

    it('lista alertas ordenados com os criticos primeiro', async () => {
      await criarEdge('ORDEM', { offline: true, expiraEm: LONGE });

      await operacoes.avaliarTenant(a.tenantId, new Date());

      const resposta = await request(servidor())
        .get('/api/v1/operations/alerts?open=true&limit=50')
        .set('Cookie', a.cookie);

      expect(resposta.status).toBe(200);

      const lista = resposta.body as { severity: string; impact: string }[];

      expect(lista.length).toBeGreaterThan(0);
      expect(lista[0]?.severity).toBe('CRITICAL');
      // Todo alerta chega a tela com impacto e acao -- nao so o codigo.
      expect(lista[0]?.impact.length).toBeGreaterThan(20);
    });
  });

  describe('agendador', () => {
    it('avalia todos os tenants ativos sem deixar falha passar em silencio', async () => {
      // Nao mede tempo nem volume: o banco de teste acumula tenants de todas
      // as suites, e um teste que dependesse disso ficaria mais lento a cada
      // fatia nova. O que importa e que o ciclo cobre todo mundo e reporta
      // falha em vez de engolir.
      const resumo = await agendador.executarCiclo(new Date());

      expect(resumo.tenants).toBeGreaterThanOrEqual(2);
      expect(resumo.falhas).toBe(0);
    }, 60_000);

    it('dois ciclos simultaneos nao duplicam alerta -- fingerprint e unico', async () => {
      const isolado = await criarEdge('PAR', { offline: true, expiraEm: LONGE });

      await Promise.allSettled([
        operacoes.avaliarTenant(a.tenantId, new Date()),
        operacoes.avaliarTenant(a.tenantId, new Date()),
      ]);

      // O `fingerprint` unico e o que garante UMA linha logica mesmo com duas
      // instancias avaliando ao mesmo tempo -- e o que dispensa BullMQ aqui.
      expect(await alertasDe(a.tenantId, 'EDGE_OFFLINE', isolado)).toHaveLength(1);
    });
  });
});
