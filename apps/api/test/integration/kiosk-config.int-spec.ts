import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { assinar } from '@arenahub/api-contracts';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { KioskAuthService } from '../../src/modules/kiosk-auth/kiosk-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F49, Task 4 -- heartbeat real e configuracao resolvida em tres camadas.
 *
 * Mesmo molde de tenants (A e B) do `kiosk-auth.int-spec.ts` (Task 3).
 */
describe('F49 -- heartbeat e config do totem', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);

  type Totem = {
    tenantId: string;
    gymUnitId: string;
    kioskDeviceId: string;
    keyId: string;
    segredo: string;
  };

  const totemA: Totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };
  const totemB: Totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const CORPO = { agentVersion: '0.1.0', localTimeMs: 0 };

  /** Forma da resposta de `GET /api/v1/kiosk/config`, so o que os testes leem. */
  interface RespostaConfig {
    version: number;
    config: { sessao: { duracaoSegundos: number }; identificacao: unknown };
  }

  const assinarPedido = (
    totem: Totem,
    corpo: unknown,
    caminho: string,
    metodo: 'GET' | 'POST' = 'POST',
  ): Record<string, string> => {
    const body = metodo === 'GET' ? '' : JSON.stringify(corpo);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID();

    return {
      'x-kiosk-key-id': totem.keyId,
      'x-kiosk-timestamp': String(timestamp),
      'x-kiosk-nonce': nonce,
      'x-kiosk-signature': assinar(
        {
          keyId: totem.keyId,
          timestamp,
          nonce,
          method: metodo,
          pathAndQuery: caminho,
          body,
        },
        totem.segredo,
      ),
    };
  };

  /** Monta tenant + unidade + dispositivo + credencial de totem, isolados por rotulo. */
  const montarTotem = async (alvo: Totem, rotulo: string): Promise<void> => {
    const tenant = await db.tenant.create({
      data: {
        slug: `kiosk-cfg-${rotulo}-${sufixo}`,
        legalName: `Kiosk Cfg ${rotulo} LTDA`,
        displayName: `Kiosk Cfg ${rotulo}`,
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

    const dispositivo = await db.kioskDevice.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `TOTEM-CFG-${rotulo}-${sufixo}` },
    });

    const segredo = randomBytes(32).toString('hex');
    const keyId = `kiosk-cfg-${rotulo}-${sufixo}`;

    await db.kioskCredential.create({
      data: {
        tenantId: tenant.id,
        kioskDeviceId: dispositivo.id,
        keyId,
        encryptedSecret: app.get(KioskAuthService).cifrarSegredo(segredo),
        activeFrom: new Date(Date.now() - 60_000),
        expiresAt: null,
      },
    });

    Object.assign(alvo, {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      kioskDeviceId: dispositivo.id,
      keyId,
      segredo,
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = modulo.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    await montarTotem(totemA, 'a');
    await montarTotem(totemB, 'b');

    // Publica a config do tenant A -- torna configVersion=1 previsivel para
    // os testes de heartbeat e config abaixo.
    await db.kioskConfiguration.create({
      data: {
        tenantId: totemA.tenantId,
        gymUnitId: null,
        kioskDeviceId: null,
        version: 1,
        publishedAt: new Date(),
        payload: { sessao: { duracaoSegundos: 60 } },
      },
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: totemA.tenantId } });
    await db.tenant.delete({ where: { id: totemB.tenantId } });
    await app.close();
  });

  it('heartbeat devolve a versao publicada e carimba o dispositivo', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(totemA, CORPO, '/api/v1/kiosk/heartbeat'))
      .send(CORPO)
      .expect(200);

    expect(resposta.body).toMatchObject({ configVersion: 1 });
    expect(typeof (resposta.body as { serverTime: string }).serverTime).toBe('string');

    const dispositivo = await db.kioskDevice.findUniqueOrThrow({
      where: { id: totemA.kioskDeviceId },
    });

    expect(dispositivo.lastHeartbeat).not.toBeNull();
  });

  it('config devolve a camada da unidade resolvida sobre o padrao', async () => {
    const resposta = await request(servidor())
      .get('/api/v1/kiosk/config')
      .set(assinarPedido(totemA, '', '/api/v1/kiosk/config', 'GET'))
      .expect(200);

    const corpo = resposta.body as RespostaConfig;

    expect(corpo.version).toBe(1);
    expect(corpo.config.sessao.duracaoSegundos).toBe(60);
    expect(corpo.config.identificacao).toEqual({
      cpf: true,
      facial: false,
      qrCodeDoApp: false,
    });
  });

  /**
   * Prova que o `orderBy` do servico e OBRIGATORIO, nao decorativo.
   *
   * As demais linhas deste arquivo inserem as configuracoes ja em ordem
   * crescente de `version`, entao a ordem fisica de insercao no Postgres
   * coincide com a ordenada -- a ausencia de `orderBy` nunca seria exercida.
   * Aqui a versao 3 e publicada ANTES da versao 2, na mesma camada (tenant
   * inteiro). Sem `orderBy: [{ version: 'asc' }]`, o `.at(-1)` do servico
   * pegaria "a ultima que o banco decidiu devolver" -- que, dependendo do
   * plano de execucao, pode ser a 2 (inserida por ultimo). Com o `orderBy`,
   * so a MAIOR version pode vencer, nunca a inserida por ultimo.
   */
  it('config resolve pela MAIOR version publicada, nao pela ordem de insercao', async () => {
    const totemOrdem: Totem = {
      tenantId: '',
      gymUnitId: '',
      kioskDeviceId: '',
      keyId: '',
      segredo: '',
    };

    await montarTotem(totemOrdem, `ordem-${randomUUID().slice(0, 8)}`);

    // version 3 primeiro, version 2 depois -- fora de ordem de insercao.
    await db.kioskConfiguration.create({
      data: {
        tenantId: totemOrdem.tenantId,
        gymUnitId: null,
        kioskDeviceId: null,
        version: 3,
        publishedAt: new Date(),
        payload: { marca: { nomeDaAcademia: 'VERSAO TRES' } },
      },
    });

    await db.kioskConfiguration.create({
      data: {
        tenantId: totemOrdem.tenantId,
        gymUnitId: null,
        kioskDeviceId: null,
        version: 2,
        publishedAt: new Date(),
        payload: { marca: { nomeDaAcademia: 'VERSAO DOIS' } },
      },
    });

    const resposta = await request(servidor())
      .get('/api/v1/kiosk/config')
      .set(assinarPedido(totemOrdem, '', '/api/v1/kiosk/config', 'GET'))
      .expect(200);

    const corpo = resposta.body as RespostaConfig & { config: { marca: { nomeDaAcademia: string } } };

    expect(corpo.version).toBe(3);
    expect(corpo.config.marca.nomeDaAcademia).toBe('VERSAO TRES');

    await db.tenant.delete({ where: { id: totemOrdem.tenantId } });
  });

  /**
   * Achado da revisao final da F49: a unique constraint e
   * [tenantId, gymUnitId, kioskDeviceId, version] -- cada camada tem o
   * PROPRIO contador. Publicar a PRIMEIRA config de unidade em version:1
   * enquanto o tenant ja esta em version:5 muda a tela (a unidade agora
   * responde por `identificacao`), mas o `.at(-1)?.version` antigo (maior
   * entre as tres camadas achatadas) continuava devolvendo 5 -- o totem
   * nunca recarregava porque o numero que ele compara no boot nao mudou
   * (ADR-042, Decisao 3).
   */
  it('configVersion muda quando a PRIMEIRA config de unidade e publicada sobre um tenant ja avancado', async () => {
    const totemRevisor: Totem = {
      tenantId: '',
      gymUnitId: '',
      kioskDeviceId: '',
      keyId: '',
      segredo: '',
    };

    await montarTotem(totemRevisor, `revisor-${randomUUID().slice(0, 8)}`);

    await db.kioskConfiguration.create({
      data: {
        tenantId: totemRevisor.tenantId,
        gymUnitId: null,
        kioskDeviceId: null,
        version: 5,
        publishedAt: new Date(),
        payload: { marca: { nomeDaAcademia: 'TENANT EM V5' } },
      },
    });

    const respostaAntes = await request(servidor())
      .get('/api/v1/kiosk/config')
      .set(assinarPedido(totemRevisor, '', '/api/v1/kiosk/config', 'GET'))
      .expect(200);

    const versionAntes = (respostaAntes.body as RespostaConfig).version;

    // Primeira config de UNIDADE -- camada propria, contador proprio.
    await db.kioskConfiguration.create({
      data: {
        tenantId: totemRevisor.tenantId,
        gymUnitId: totemRevisor.gymUnitId,
        kioskDeviceId: null,
        version: 1,
        publishedAt: new Date(),
        payload: { identificacao: { cpf: false, facial: false, qrCodeDoApp: true } },
      },
    });

    const respostaDepois = await request(servidor())
      .get('/api/v1/kiosk/config')
      .set(assinarPedido(totemRevisor, '', '/api/v1/kiosk/config', 'GET'))
      .expect(200);

    const corpoDepois = respostaDepois.body as RespostaConfig;

    // A tela mudou de fato (a unidade venceu em `identificacao`) -- se o
    // numero nao mudasse junto, o totem nao recarregaria a tela nova.
    expect(corpoDepois.config.identificacao).toEqual({
      cpf: false,
      facial: false,
      qrCodeDoApp: true,
    });
    expect(corpoDepois.version).not.toBe(versionAntes);

    await db.tenant.delete({ where: { id: totemRevisor.tenantId } });
  });

  it('a configuracao do tenant B NAO vaza para o totem do tenant A', async () => {
    await db.kioskConfiguration.create({
      data: {
        tenantId: totemB.tenantId,
        gymUnitId: totemB.gymUnitId,
        version: 2,
        publishedAt: new Date(),
        payload: { marca: { nomeDaAcademia: 'SEGREDO DO B' } },
      },
    });

    const resposta = await request(servidor())
      .get('/api/v1/kiosk/config')
      .set(assinarPedido(totemA, '', '/api/v1/kiosk/config', 'GET'))
      .expect(200);

    expect(JSON.stringify(resposta.body)).not.toContain('SEGREDO DO B');
  });

  it('rascunho (sem published_at) NAO e servido ao totem', async () => {
    await db.kioskConfiguration.create({
      data: {
        tenantId: totemA.tenantId,
        gymUnitId: totemA.gymUnitId,
        version: 9,
        publishedAt: null,
        payload: { marca: { nomeDaAcademia: 'RASCUNHO' } },
      },
    });

    const resposta = await request(servidor())
      .get('/api/v1/kiosk/config')
      .set(assinarPedido(totemA, '', '/api/v1/kiosk/config', 'GET'))
      .expect(200);

    expect((resposta.body as RespostaConfig).version).toBe(1);
    expect(JSON.stringify(resposta.body)).not.toContain('RASCUNHO');
  });

  /**
   * Divida herdada da Task 3: o `kioskContext` resolvido pelo guard nunca
   * era observavel por teste (o heartbeat minimo devolvia so `{ ok: true }`).
   * Um re-revisor provou corrompendo `tenantId` no servico de auth que os 10
   * testes de assinatura seguiam verdes -- nada provava que o contexto
   * usado era o da CREDENCIAL, e nao de outro lugar.
   *
   * Como expor tenantId/gymUnitId na resposta seria vazamento desnecessario
   * (superficie minima), a prova e pelo efeito observavel: publica uma
   * config so no tenant B, entao assina uma requisicao com a credencial do
   * totem A mas manda no CORPO um tenantId/gymUnitId do totem B. Se o
   * contexto usado fosse o do corpo (em vez da credencial), a config do B
   * vazaria para essa resposta -- exatamente o que a asserção nega.
   */
  it('tenantId/gymUnitId do corpo sao ignorados -- so a credencial decide', async () => {
    await db.kioskConfiguration.create({
      data: {
        tenantId: totemB.tenantId,
        gymUnitId: null,
        kioskDeviceId: null,
        version: 3,
        publishedAt: new Date(),
        payload: { marca: { nomeDaAcademia: 'CONFIG EXCLUSIVA DO TENANT B' } },
      },
    });

    const corpoComIdsDoOutroTenant = {
      ...CORPO,
      tenantId: totemB.tenantId,
      gymUnitId: totemB.gymUnitId,
    };

    const respostaHeartbeat = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(totemA, corpoComIdsDoOutroTenant, '/api/v1/kiosk/heartbeat'))
      .send(corpoComIdsDoOutroTenant)
      .expect(200);

    // configVersion continua sendo a do tenant A (1), nunca a do B (3):
    // prova que o contexto resolvido ignorou os ids mandados no corpo.
    expect(respostaHeartbeat.body).toMatchObject({ configVersion: 1 });

    const respostaConfig = await request(servidor())
      .get('/api/v1/kiosk/config')
      .set(assinarPedido(totemA, '', '/api/v1/kiosk/config', 'GET'))
      .expect(200);

    expect((respostaConfig.body as RespostaConfig).version).toBe(1);
    expect(JSON.stringify(respostaConfig.body)).not.toContain('CONFIG EXCLUSIVA DO TENANT B');
  });
});
