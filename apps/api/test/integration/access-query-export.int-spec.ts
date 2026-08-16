import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F11, Tasks 3 e 4 -- consulta e exportacao de eventos.
 *
 * O que so integracao prova:
 *
 *   - o cursor pagina sem pular nem repetir, mesmo com eventos no MESMO
 *     instante (uma rajada do leitor cabe num milissegundo);
 *   - o periodo e SEMPRE limitado, mesmo quando ninguem manda filtro;
 *   - tenant A nao le evento nem exportacao de tenant B;
 *   - o CSV sai com o dado certo e sem formula viva.
 */
describe('F11 -- consulta e exportacao de eventos', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-consulta';

  const a = { tenantId: '', gymUnitId: '', studentId: '', cookie: '' };
  const b = { tenantId: '', gymUnitId: '' };

  /** Objetos gravados pelo storage falso, para inspecionar o CSV. */
  const gravados = new Map<string, Buffer>();

  const storageFalso = {
    createPrivateUpload: () =>
      Promise.resolve({ uploadUrl: 'https://storage.test/x', expiresAt: '' }),
    headPrivateObject: () => Promise.resolve({ size: 1, contentType: 'text/csv' }),
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
        downloadUrl: `https://storage.test/${entrada.key}?assinada=1`,
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

  const criarEvento = async (
    tenantId: string,
    gymUnitId: string,
    quando: Date,
    sobrescreve: Record<string, unknown> = {},
  ): Promise<string> => {
    const evento = await db.accessEvent.create({
      data: {
        tenantId,
        gymUnitId,
        outcome: 'ALLOW',
        reason: 'ACTIVE_ENTITLEMENT',
        policyVersion: '1.0.0',
        mode: 'ONLINE',
        method: 'FACIAL',
        occurredAt: quando,
        correlationId: randomUUID(),
        idempotencyKey: `q-${randomUUID()}`,
        detail: {},
        ...sobrescreve,
      },
    });

    return evento.id;
  };

  const esperarConclusao = async (jobId: string, tentativas = 40): Promise<string> => {
    for (let i = 0; i < tentativas; i += 1) {
      const job = await db.dataExportJob.findUniqueOrThrow({ where: { id: jobId } });

      if (job.status === 'COMPLETED' || job.status === 'FAILED') return job.status;

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return 'TIMEOUT';
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

    for (const [rotulo, alvo] of [
      ['a', a],
      ['b', b],
    ] as const) {
      const tenant = await db.tenant.create({
        data: {
          slug: `f11q-${rotulo}-${sufixo}`,
          legalName: `F11Q ${rotulo}`,
          displayName: `F11Q ${rotulo}`,
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

      alvo.tenantId = tenant.id;
      alvo.gymUnitId = unidade.id;
    }

    const aluno = await db.student.create({
      data: {
        tenantId: a.tenantId,
        membershipNumber: `MQ-${sufixo}`,
        // Nome com formula E com virgula: o pior caso do CSV numa linha so.
        fullName: '=HYPERLINK("http://atacante.test"), Silva',
        birthDate: new Date('1992-01-01T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    a.studentId = aluno.id;

    const usuario = await db.user.create({
      data: {
        email: `f11q-${sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash(SENHA),
      },
    });

    await db.tenantMembership.create({ data: { tenantId: a.tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId: a.tenantId, name: 'CONSULTA', isSystem: false },
    });

    const permissao = await db.permission.upsert({
      where: { code: 'access.read' },
      create: { code: 'access.read' },
      update: {},
    });

    await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
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

  describe('consulta com periodo limitado', () => {
    it('lista eventos do periodo padrao quando nao ha filtro', async () => {
      await criarEvento(a.tenantId, a.gymUnitId, new Date());

      const resposta = await request(servidor())
        .get('/api/v1/access-events')
        .set('Cookie', a.cookie);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as { eventos: unknown[]; periodoLimitado: boolean };

      expect(corpo.eventos.length).toBeGreaterThan(0);
      expect(corpo.periodoLimitado).toBe(false);
    });

    it('CORTA periodo maior que o maximo e avisa', async () => {
      const resposta = await request(servidor())
        .get('/api/v1/access-events')
        .query({
          from: new Date('2020-01-01T00:00:00.000Z').toISOString(),
          to: new Date().toISOString(),
        })
        .set('Cookie', a.cookie);

      expect(resposta.status).toBe(200);
      // Sem o corte, isto varreria a tabela inteira e derrubaria a API para
      // quem esta com uma pessoa na catraca.
      expect((resposta.body as { periodoLimitado: boolean }).periodoLimitado).toBe(true);
    });

    it('preserva o FIM ao cortar -- quem pede periodo longo quer o recente', async () => {
      const agora = new Date();

      await criarEvento(a.tenantId, a.gymUnitId, agora);

      const resposta = await request(servidor())
        .get('/api/v1/access-events')
        .query({ from: '2020-01-01T00:00:00.000Z', to: agora.toISOString() })
        .set('Cookie', a.cookie);

      expect((resposta.body as { eventos: unknown[] }).eventos.length).toBeGreaterThan(0);
    });

    it('filtra por outcome', async () => {
      await criarEvento(a.tenantId, a.gymUnitId, new Date(), {
        outcome: 'DENY',
        reason: 'NO_ENTITLEMENT',
      });

      const resposta = await request(servidor())
        .get('/api/v1/access-events')
        .query({ outcome: 'DENY' })
        .set('Cookie', a.cookie);

      const eventos = (resposta.body as { eventos: { outcome: string }[] }).eventos;

      expect(eventos.length).toBeGreaterThan(0);
      expect(eventos.every((e) => e.outcome === 'DENY')).toBe(true);
    });

    it('filtra por modo -- override e o que a auditoria procura', async () => {
      await criarEvento(a.tenantId, a.gymUnitId, new Date(), {
        mode: 'OVERRIDE',
        method: 'MANUAL',
        reason: 'MANUAL_OVERRIDE',
      });

      const resposta = await request(servidor())
        .get('/api/v1/access-events')
        .query({ mode: 'OVERRIDE' })
        .set('Cookie', a.cookie);

      const eventos = (resposta.body as { eventos: { mode: string }[] }).eventos;

      expect(eventos.length).toBeGreaterThan(0);
      expect(eventos.every((e) => e.mode === 'OVERRIDE')).toBe(true);
    });
  });

  describe('cursor estavel', () => {
    it('pagina sem pular nem repetir, com eventos no MESMO instante', async () => {
      const instante = new Date('2026-08-16T10:00:00.000Z');

      // Cinco eventos no mesmo milissegundo -- o que uma rajada do leitor
      // produz de verdade.
      const ids = new Set<string>();

      for (let i = 0; i < 5; i += 1) {
        ids.add(await criarEvento(a.tenantId, a.gymUnitId, instante));
      }

      const vistos = new Set<string>();
      let cursor: string | undefined;

      for (let pagina = 0; pagina < 10; pagina += 1) {
        const resposta = await request(servidor())
          .get('/api/v1/access-events')
          .query({
            from: new Date(instante.getTime() - 1000).toISOString(),
            to: new Date(instante.getTime() + 1000).toISOString(),
            limit: 2,
            ...(cursor ? { cursor } : {}),
          })
          .set('Cookie', a.cookie);

        const corpo = resposta.body as {
          eventos: { id: string }[];
          proximoCursor: string | null;
        };

        for (const evento of corpo.eventos) {
          // Repetido entre paginas seria dado contado duas vezes num
          // relatorio de frequencia.
          expect(vistos.has(evento.id)).toBe(false);
          vistos.add(evento.id);
        }

        if (!corpo.proximoCursor) break;

        cursor = corpo.proximoCursor;
      }

      // Nenhum pulado.
      for (const id of ids) expect(vistos.has(id)).toBe(true);
    });

    it('cursor corrompido devolve vazio em vez de recomecar', async () => {
      const resposta = await request(servidor())
        .get('/api/v1/access-events')
        .query({ cursor: 'lixo-que-nao-decodifica' })
        .set('Cookie', a.cookie);

      expect(resposta.status).toBe(200);
      // Recomecar produziria laco infinito em quem estivesse paginando.
      expect((resposta.body as { eventos: unknown[] }).eventos).toHaveLength(0);
    });
  });

  describe('isolamento (M1-NFR-007)', () => {
    it('nao lista evento de outro tenant', async () => {
      const alheio = await criarEvento(b.tenantId, b.gymUnitId, new Date());

      const resposta = await request(servidor())
        .get('/api/v1/access-events')
        .query({ limit: 200 })
        .set('Cookie', a.cookie);

      const ids = (resposta.body as { eventos: { id: string }[] }).eventos.map((e) => e.id);

      expect(ids).not.toContain(alheio);
    });

    it('404 indistinguivel no detalhe de evento alheio', async () => {
      const alheio = await criarEvento(b.tenantId, b.gymUnitId, new Date());

      const resposta = await request(servidor())
        .get(`/api/v1/access-events/${alheio}`)
        .set('Cookie', a.cookie);

      expect(resposta.status).toBe(404);
    });
  });

  describe('detalhe do evento', () => {
    it('mostra o original e as correcoes, sem oferecer edicao', async () => {
      const original = await criarEvento(a.tenantId, a.gymUnitId, new Date());

      const resposta = await request(servidor())
        .get(`/api/v1/access-events/${original}`)
        .set('Cookie', a.cookie);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as {
        evento: { id: string };
        policyVersion: string;
        correcoes: unknown[];
      };

      expect(corpo.evento.id).toBe(original);
      expect(corpo.policyVersion).toBe('1.0.0');
      expect(Array.isArray(corpo.correcoes)).toBe(true);
    });
  });

  describe('exportacao assincrona', () => {
    it('responde na hora e conclui em background', async () => {
      await criarEvento(a.tenantId, a.gymUnitId, new Date(), { studentId: a.studentId });

      const pedido = await request(servidor())
        .post('/api/v1/access-events/exports')
        .set('Cookie', a.cookie)
        .send({ idempotencyKey: `exp-${randomUUID()}` });

      expect(pedido.status).toBe(201);

      const { id, status } = pedido.body as { id: string; status: string };

      expect(status).toBe('PENDING');

      expect(await esperarConclusao(id)).toBe('COMPLETED');
    });

    it('o CSV sai com cabecalho e sem formula viva', async () => {
      await criarEvento(a.tenantId, a.gymUnitId, new Date(), { studentId: a.studentId });

      const pedido = await request(servidor())
        .post('/api/v1/access-events/exports')
        .set('Cookie', a.cookie)
        .send({ idempotencyKey: `exp-csv-${randomUUID()}` });

      const { id } = pedido.body as { id: string };

      expect(await esperarConclusao(id)).toBe('COMPLETED');

      const job = await db.dataExportJob.findUniqueOrThrow({ where: { id } });
      const conteudo = gravados.get(job.objectKey!)?.toString('utf8') ?? '';

      expect(conteudo).toContain('event_id,occurred_at_utc');
      // O nome do aluno tem formula E virgula. Neutralizado e entre aspas.
      expect(conteudo).toContain(`"'=HYPERLINK`);
      // Sem BOM, o Excel em portugues abriria acentuacao errada.
      expect(conteudo.charCodeAt(0)).toBe(0xfeff);
    });

    it('exporta as duas colunas de tempo -- UTC e local', async () => {
      await criarEvento(a.tenantId, a.gymUnitId, new Date('2026-08-16T17:00:00.000Z'));

      const pedido = await request(servidor())
        .post('/api/v1/access-events/exports')
        .set('Cookie', a.cookie)
        .send({
          from: '2026-08-16T00:00:00.000Z',
          to: '2026-08-17T00:00:00.000Z',
          idempotencyKey: `exp-tz-${randomUUID()}`,
        });

      const { id } = pedido.body as { id: string };

      expect(await esperarConclusao(id)).toBe('COMPLETED');

      const job = await db.dataExportJob.findUniqueOrThrow({ where: { id } });
      const conteudo = gravados.get(job.objectKey!)?.toString('utf8') ?? '';

      expect(conteudo).toContain('2026-08-16T17:00:00.000Z');
      expect(conteudo).toContain('2026-08-16 14:00:00');
    });

    it('mesma chave devolve o MESMO job -- clique duplo nao gera dois arquivos', async () => {
      const chave = `exp-idem-${randomUUID()}`;

      const primeiro = await request(servidor())
        .post('/api/v1/access-events/exports')
        .set('Cookie', a.cookie)
        .send({ idempotencyKey: chave });

      const segundo = await request(servidor())
        .post('/api/v1/access-events/exports')
        .set('Cookie', a.cookie)
        .send({ idempotencyKey: chave });

      expect((segundo.body as { id: string }).id).toBe((primeiro.body as { id: string }).id);
    });

    it('mesma chave com filtro DIFERENTE e conflito', async () => {
      const chave = `exp-conf-${randomUUID()}`;

      await request(servidor())
        .post('/api/v1/access-events/exports')
        .set('Cookie', a.cookie)
        .send({ idempotencyKey: chave, outcome: 'ALLOW' });

      const divergente = await request(servidor())
        .post('/api/v1/access-events/exports')
        .set('Cookie', a.cookie)
        .send({ idempotencyKey: chave, outcome: 'DENY' });

      expect(divergente.status).toBe(409);
    });

    it('download so depois de pronto, e a autorizacao e reconferida', async () => {
      const pedido = await request(servidor())
        .post('/api/v1/access-events/exports')
        .set('Cookie', a.cookie)
        .send({ idempotencyKey: `exp-dl-${randomUUID()}` });

      const { id } = pedido.body as { id: string };

      expect(await esperarConclusao(id)).toBe('COMPLETED');

      const download = await request(servidor())
        .post(`/api/v1/exports/${id}/download`)
        .set('Cookie', a.cookie);

      expect(download.status).toBe(201);

      const corpo = download.body as { downloadUrl: string; expiresAt: string };

      expect(corpo.downloadUrl).toContain('assinada=1');
      // A URL e curta: link de dado de acesso nao pode durar o dia.
      expect(new Date(corpo.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(600_000);
    });

    it('registra na auditoria o PEDIDO e o DOWNLOAD', async () => {
      const pedido = await request(servidor())
        .post('/api/v1/access-events/exports')
        .set('Cookie', a.cookie)
        .send({ idempotencyKey: `exp-audit-${randomUUID()}` });

      const { id } = pedido.body as { id: string };

      expect(await esperarConclusao(id)).toBe('COMPLETED');

      await request(servidor())
        .post(`/api/v1/exports/${id}/download`)
        .set('Cookie', a.cookie);

      const acoes = await db.auditLog.findMany({
        where: { targetId: id },
        select: { action: true },
      });

      const nomes = acoes.map((x) => x.action);

      // O que importa para a LGPD e quando o dado SAIU, e ele sai no
      // download -- nao no pedido.
      expect(nomes).toContain('exports.requested');
      expect(nomes).toContain('exports.downloaded');
    });

    it('404 para exportacao de outro tenant', async () => {
      const alheia = await db.dataExportJob.create({
        data: {
          tenantId: b.tenantId,
          requesterId: randomUUID(),
          type: 'ACCESS_EVENTS',
          filters: {},
          idempotencyKey: `alheia-${randomUUID()}`,
        },
      });

      const resposta = await request(servidor())
        .get(`/api/v1/exports/${alheia.id}`)
        .set('Cookie', a.cookie);

      expect(resposta.status).toBe(404);
    });

    it('recusa download de exportacao que ainda nao terminou', async () => {
      const job = await db.dataExportJob.create({
        data: {
          tenantId: a.tenantId,
          requesterId: randomUUID(),
          type: 'ACCESS_EVENTS',
          status: 'RUNNING',
          filters: {},
          idempotencyKey: `rodando-${randomUUID()}`,
        },
      });

      const resposta = await request(servidor())
        .post(`/api/v1/exports/${job.id}/download`)
        .set('Cookie', a.cookie);

      expect(resposta.status).toBe(409);
    });
  });
});
