import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { assinar, CONFIG_PADRAO_DO_TOTEM } from '@arenahub/api-contracts';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { KioskAuthService } from '../../src/modules/kiosk-auth/kiosk-auth.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import type { EstadoDaConfiguracao } from '../../src/modules/kiosk-admin/kiosk-admin-config.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

describe('F50 -- rascunho unico por camada', () => {
  let db: PrismaService;
  let tenantId = '';
  let gymUnitId = '';
  let kioskDeviceId = '';
  let outroDeviceId = '';

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = modulo.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    const sufixo = randomUUID().slice(0, 8);
    const tenant = await db.tenant.create({
      data: { slug: `t-${sufixo}`, legalName: `T-${sufixo} LTDA`, displayName: `T-${sufixo}` },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `U-${sufixo}`,
        name: `U-${sufixo}`,
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    gymUnitId = unidade.id;

    const device = await db.kioskDevice.create({
      data: { tenantId, gymUnitId, code: `K1-${sufixo}` },
    });
    kioskDeviceId = device.id;

    const outro = await db.kioskDevice.create({
      data: { tenantId, gymUnitId, code: `K2-${sufixo}` },
    });
    outroDeviceId = outro.id;
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } });
  });

  const rascunho = (deviceId: string | null, version: number) =>
    db.kioskConfiguration.create({
      data: {
        tenantId,
        gymUnitId: deviceId === null ? gymUnitId : gymUnitId,
        kioskDeviceId: deviceId,
        version,
        publishedAt: null,
        payload: CONFIG_PADRAO_DO_TOTEM,
      },
    });

  it('recusa dois rascunhos da MESMA camada', async () => {
    await rascunho(kioskDeviceId, 1);

    await expect(rascunho(kioskDeviceId, 2)).rejects.toThrow();
  });

  it('aceita rascunhos de camadas DIFERENTES', async () => {
    // camada de outro dispositivo -- deve passar
    await expect(rascunho(outroDeviceId, 1)).resolves.toBeDefined();

    // camada de unidade (kiosk_device_id NULL) -- deve passar
    await expect(rascunho(null, 1)).resolves.toBeDefined();
  });

  it('aceita varias versoes PUBLICADAS da mesma camada', async () => {
    const publicada = (version: number) =>
      db.kioskConfiguration.create({
        data: {
          tenantId,
          gymUnitId,
          kioskDeviceId: outroDeviceId,
          version,
          publishedAt: new Date(),
          payload: CONFIG_PADRAO_DO_TOTEM,
        },
      });

    await expect(publicada(10)).resolves.toBeDefined();
    await expect(publicada(11)).resolves.toBeDefined();
  });
});

/**
 * F50, Task 3 -- as cinco rotas administrativas de configuracao do totem.
 *
 * Sessao de GERENTE (cookie), nunca HMAC de dispositivo -- por isso o
 * modulo e separado do `kiosk`. O teste que mais importa e o de isolamento:
 * ele prova que o `tenantId` sai da IDENTIDADE autenticada, nunca do corpo
 * da requisicao (mesmo molde de `billing-http.int-spec.ts`).
 */
describe('F50 -- rotas administrativas de configuracao', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-kiosk-admin';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  type Tenant = { id: string; gymUnitId: string; deviceId: string; cookieGestor: string };

  const tenantA: Tenant = { id: '', gymUnitId: '', deviceId: '', cookieGestor: '' };
  const tenantB: Tenant = { id: '', gymUnitId: '', deviceId: '', cookieGestor: '' };

  /** Cria usuario com `device.read` + `device.manage` e devolve o cookie de sessao. */
  async function criarGestor(tenantId: string, rotulo: string): Promise<string> {
    const usuario = await db.user.create({
      data: {
        email: `f50-admin-${rotulo}-${sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash(SENHA),
      },
    });

    await db.tenantMembership.create({ data: { tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId, name: `PAPEL_ADMIN_TOTEM_${rotulo}_${sufixo}`, isSystem: false },
    });

    for (const code of ['device.read', 'device.manage']) {
      const permissao = await db.permission.upsert({ where: { code }, create: { code }, update: {} });

      await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    }

    await db.userRole.create({ data: { tenantId, userId: usuario.id, roleId: papel.id } });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: usuario.email, password: SENHA });

    return cookieDeAcesso(login);
  }

  /** Monta tenant + unidade + KioskDevice + gestor, isolados por rotulo. */
  const montarTenant = async (alvo: Tenant, rotulo: string): Promise<void> => {
    const tenant = await db.tenant.create({
      data: {
        slug: `f50-admin-${rotulo}-${sufixo}`,
        legalName: `F50 Admin ${rotulo} ${sufixo} LTDA`,
        displayName: `F50 Admin ${rotulo} ${sufixo}`,
      },
    });
    alvo.id = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: `UNI-${rotulo}-${sufixo}`,
        name: `Unidade ${rotulo}`,
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    alvo.gymUnitId = unidade.id;

    const device = await db.kioskDevice.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `TOTEM-ADMIN-${rotulo}-${sufixo}` },
    });
    alvo.deviceId = device.id;

    alvo.cookieGestor = await criarGestor(tenant.id, rotulo);
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    await montarTenant(tenantA, 'a');
    await montarTenant(tenantB, 'b');
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.user.deleteMany({ where: { email: { contains: `f50-admin-` } } });
    await app.close();
  });

  it('GET /kiosk-devices lista os dispositivos do tenant autenticado', async () => {
    const resposta = await request(servidor())
      .get('/api/v1/admin/kiosk-devices')
      .set('Cookie', tenantA.cookieGestor)
      .expect(200);

    const corpo = resposta.body as { id: string }[];

    expect(corpo.some((d) => d.id === tenantA.deviceId)).toBe(true);
    expect(corpo.some((d) => d.id === tenantB.deviceId)).toBe(false);
  });

  it('GET config devolve o padrao quando nada foi publicado', async () => {
    const resposta = await request(servidor())
      .get(`/api/v1/admin/kiosk-devices/${tenantA.deviceId}/config`)
      .set('Cookie', tenantA.cookieGestor)
      .expect(200);

    const corpo = resposta.body as EstadoDaConfiguracao;

    expect(corpo.publicada).toBeNull();
    expect(corpo.rascunho).toBeNull();
    expect(corpo.efetiva.aparencia.accent).toBe('AZUL');
    expect(corpo.configVersion).toBe(0);
  });

  it('device de OUTRO tenant responde 404, nunca 403', async () => {
    await request(servidor())
      .get(`/api/v1/admin/kiosk-devices/${tenantB.deviceId}/config`)
      .set('Cookie', tenantA.cookieGestor)
      .expect(404);
  });

  it('tenantId do CORPO e ignorado -- vem da identidade', async () => {
    // Se a rota lesse tenantId do corpo, este PUT escreveria no tenant B.
    await request(servidor())
      .put(`/api/v1/admin/kiosk-devices/${tenantA.deviceId}/config`)
      .set('Cookie', tenantA.cookieGestor)
      .send({ ...CONFIG_PADRAO_DO_TOTEM, tenantId: tenantB.id })
      .expect(204);

    // A prova e o ESTADO NO BANCO, nao o que a rota devolveu.
    const linhas = await db.kioskConfiguration.findMany({ where: { tenantId: tenantB.id } });

    expect(linhas).toHaveLength(0);
  });

  it('publicar cria versao nova e NAO altera a publicada anterior', async () => {
    const salvarEPublicar = async (accent: 'AZUL' | 'VERDE') => {
      await request(servidor())
        .put(`/api/v1/admin/kiosk-devices/${tenantA.deviceId}/config`)
        .set('Cookie', tenantA.cookieGestor)
        .send({ ...CONFIG_PADRAO_DO_TOTEM, aparencia: { accent, altoContrastePadrao: false } })
        .expect(204);

      const r = await request(servidor())
        .post(`/api/v1/admin/kiosk-devices/${tenantA.deviceId}/config/publish`)
        .set('Cookie', tenantA.cookieGestor)
        .expect(201);

      return (r.body as { version: number }).version;
    };

    const v1 = await salvarEPublicar('AZUL');
    const v2 = await salvarEPublicar('VERDE');

    expect(v2).toBe(v1 + 1);

    const publicadas = await db.kioskConfiguration.findMany({
      where: { kioskDeviceId: tenantA.deviceId, publishedAt: { not: null } },
      orderBy: { version: 'asc' },
    });

    expect(publicadas).toHaveLength(2);
    // A v1 continua AZUL: publicar nunca reescreve versao anterior.
    expect((publicadas[0]!.payload as { aparencia: { accent: string } }).aparencia.accent).toBe(
      'AZUL',
    );
    expect((publicadas[1]!.payload as { aparencia: { accent: string } }).aparencia.accent).toBe(
      'VERDE',
    );
  });

  it('descartar rascunho restaura o publicado', async () => {
    await request(servidor())
      .put(`/api/v1/admin/kiosk-devices/${tenantA.deviceId}/config`)
      .set('Cookie', tenantA.cookieGestor)
      .send({ ...CONFIG_PADRAO_DO_TOTEM, marca: { ...CONFIG_PADRAO_DO_TOTEM.marca, slogan: 'rascunho' } })
      .expect(204);

    await request(servidor())
      .delete(`/api/v1/admin/kiosk-devices/${tenantA.deviceId}/config/draft`)
      .set('Cookie', tenantA.cookieGestor)
      .expect(204);

    const resposta = await request(servidor())
      .get(`/api/v1/admin/kiosk-devices/${tenantA.deviceId}/config`)
      .set('Cookie', tenantA.cookieGestor)
      .expect(200);

    expect((resposta.body as EstadoDaConfiguracao).rascunho).toBeNull();
  });

  it('GET /api/v1/kiosk/config do TOTEM nunca serve rascunho', async () => {
    await request(servidor())
      .put(`/api/v1/admin/kiosk-devices/${tenantA.deviceId}/config`)
      .set('Cookie', tenantA.cookieGestor)
      .send({
        ...CONFIG_PADRAO_DO_TOTEM,
        marca: { ...CONFIG_PADRAO_DO_TOTEM.marca, slogan: 'so rascunho' },
      })
      .expect(204);

    // Rota do totem, assinada por HMAC -- credencial de dispositivo criada
    // aqui mesmo, so para este teste, ja que os totens desta describe nunca
    // publicaram credencial (o foco daqui e a sessao de gerente).
    const segredo = randomBytes(32).toString('hex');
    const keyId = `f50-admin-totem-${sufixo}`;

    await db.kioskCredential.create({
      data: {
        tenantId: tenantA.id,
        kioskDeviceId: tenantA.deviceId,
        keyId,
        encryptedSecret: app.get(KioskAuthService).cifrarSegredo(segredo),
        activeFrom: new Date(Date.now() - 60_000),
        expiresAt: null,
      },
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID();
    const caminho = '/api/v1/kiosk/config';

    const resposta = await request(servidor())
      .get(caminho)
      .set('x-kiosk-key-id', keyId)
      .set('x-kiosk-timestamp', String(timestamp))
      .set('x-kiosk-nonce', nonce)
      .set(
        'x-kiosk-signature',
        assinar({ keyId, timestamp, nonce, method: 'GET', pathAndQuery: caminho, body: '' }, segredo),
      )
      .expect(200);

    const corpo = resposta.body as { config: { marca: { slogan: string } } };

    expect(corpo.config.marca.slogan).not.toBe('so rascunho');
  });
});
