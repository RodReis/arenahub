import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CONFIG_PADRAO_DO_TOTEM, assinar, type KioskConfig } from '@arenahub/api-contracts';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { KioskAuthService } from '../../src/modules/kiosk-auth/kiosk-auth.service.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { instanteDePassagemDeHoje } from './helpers/instante-de-passagem.js';

/**
 * F51 -- tela publica: blocos, midia e indicadores.
 *
 * O QUE ESTE ARQUIVO PROVA, e que o teste de unidade nao alcanca:
 *
 *   1. os blocos publicados chegam ao totem pelo `GET /kiosk/config` REAL,
 *      passando pelo `payload` Json e pela resolucao de tres camadas;
 *   2. midia de OUTRA unidade nao vira URL assinada, mesmo gravada no banco;
 *   3. os indicadores contam `access_events` de verdade, e contam SO os da
 *      unidade daquele totem -- `M3.5-BR-001` cai se um totem contar o
 *      movimento da unidade vizinha.
 */
describe('F51 -- tela publica do totem', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);

  interface Totem {
    tenantId: string;
    gymUnitId: string;
    kioskDeviceId: string;
    keyId: string;
    segredo: string;
  }

  const totem: Totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };
  /** Segunda unidade do MESMO tenant -- o vizinho cujo movimento nao pode vazar. */
  let unidadeVizinha = '';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const CORPO = { agentVersion: '0.1.0', localTimeMs: 0 };

  /**
   * Storage DUBLADO -- o CI sobe **so Postgres**, sem MinIO. Aqui o dublê
   * REGISTRA as chaves que chegaram a ser assinadas: e o que prova que a
   * chave de outra unidade nao chegou ao storage, em vez de so conferir que
   * a resposta trouxe `midiaUrl: null`.
   */
  const assinadas: string[] = [];

  const storageFalso = {
    createPrivateUpload: () =>
      Promise.resolve({ uploadUrl: 'https://storage.test/x', expiresAt: '' }),
    headPrivateObject: () => Promise.resolve({ size: 1, contentType: 'video/mp4' }),
    deletePrivateObject: () => Promise.resolve(),
    putPrivateObject: () => Promise.resolve(),
    createPrivateDownload: (entrada: { key: string }) => {
      assinadas.push(entrada.key);

      return Promise.resolve({
        downloadUrl: `https://storage.test/${entrada.key}?assinada=1`,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
    },
    verificar: () => Promise.resolve(true),
  };

  const assinarPedido = (
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
        { keyId: totem.keyId, timestamp, nonce, method: metodo, pathAndQuery: caminho, body },
        totem.segredo,
      ),
    };
  };

  /** Publica uma camada de dispositivo com os blocos pedidos. */
  const publicar = async (blocos: KioskConfig['blocos'], version: number): Promise<void> => {
    await db.kioskConfiguration.create({
      data: {
        tenantId: totem.tenantId,
        gymUnitId: totem.gymUnitId,
        kioskDeviceId: totem.kioskDeviceId,
        version,
        publishedAt: new Date(),
        payload: { ...CONFIG_PADRAO_DO_TOTEM, blocos },
      },
    });
  };

  /** Um ALLOW na unidade pedida, no instante pedido. */
  const registrarEntrada = async (gymUnitId: string, occurredAt: Date): Promise<void> => {
    await db.accessEvent.create({
      data: {
        tenantId: totem.tenantId,
        gymUnitId,
        outcome: 'ALLOW',
        reason: 'ACTIVE_ENTITLEMENT',
        policyVersion: 'v1',
        mode: 'ONLINE',
        method: 'FACIAL',
        occurredAt,
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        detail: {},
      },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storageFalso)
      .compile();

    app = modulo.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `kiosk-pub-${sufixo}`,
        legalName: `Kiosk Pub ${sufixo} LTDA`,
        displayName: `Kiosk Pub ${sufixo}`,
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

    const vizinha = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'NORTE',
        name: 'Norte',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    unidadeVizinha = vizinha.id;

    const dispositivo = await db.kioskDevice.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `TOTEM-PUB-${sufixo}` },
    });

    const segredo = randomBytes(32).toString('hex');
    const keyId = `kiosk-pub-${sufixo}`;

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

    Object.assign(totem, {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      kioskDeviceId: dispositivo.id,
      keyId,
      segredo,
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: totem.tenantId } });
    await app.close();
  });

  it('os blocos publicados chegam ao totem, na ordem e com o tempo configurados', async () => {
    await publicar(
      {
        tempoPorBlocoSegundos: 8,
        itens: [
          { id: 'b1', habilitado: true, tipo: 'INSTAGRAM', perfil: '@arena', chamada: 'Siga' },
          {
            id: 'b2',
            habilitado: true,
            tipo: 'EVENTOS',
            titulo: 'Agenda',
            itens: [{ data: '2026-08-30', titulo: 'Aulão', informacao: '19h' }],
          },
        ],
      },
      1,
    );

    const resposta = await request(servidor())
      .get('/api/v1/kiosk/config')
      .set(assinarPedido(null, '/api/v1/kiosk/config', 'GET'))
      .expect(200);

    const { config } = resposta.body as { config: KioskConfig };

    expect(config.blocos.tempoPorBlocoSegundos).toBe(8);
    expect(config.blocos.itens.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('midia de OUTRA unidade nao vira URL, mesmo gravada no payload', async () => {
    await publicar(
      {
        tempoPorBlocoSegundos: 12,
        itens: [
          {
            id: 'v1',
            habilitado: true,
            tipo: 'VIDEO',
            titulo: 'Equipe',
            legenda: 'Conheça',
            // Chave apontando para a unidade VIZINHA -- o que aconteceria
            // se alguem editasse o payload no banco.
            midiaKey: `tenants/${totem.tenantId}/kiosk-media/${unidadeVizinha}/roubado.mp4`,
            linkExterno: null,
          },
        ],
      },
      2,
    );

    const resposta = await request(servidor())
      .get('/api/v1/kiosk/config')
      .set(assinarPedido(null, '/api/v1/kiosk/config', 'GET'))
      .expect(200);

    const { config } = resposta.body as { config: KioskConfig };
    const video = config.blocos.itens[0];

    expect(video?.tipo).toBe('VIDEO');
    expect(video).toMatchObject({ midiaUrl: null });
    // A recusa acontece ANTES do storage: a chave alheia nunca chegou a ser
    // assinada. Sem esta asserção, um servico que assinasse e depois
    // descartasse a URL passaria verde.
    expect(assinadas).toEqual([]);
  });

  /**
   * Um instante que cai DENTRO do dia local da academia e dentro da janela de
   * treino -- as duas condicoes que `checkinsDeHoje` e `treinandoAgora` medem.
   *
   * `agora - 1h` cego NAO serve, e a falha foi observada: entre 00:00 e 01:00
   * no fuso da academia, "uma hora atras" e ONTEM, `inicioDoDiaLocal` corta a
   * entrada e os dois indicadores voltam 0. O CI caiu as 03:12 UTC de
   * 01/09/2026 -- 00:12 em Sao Paulo (issue #237).
   *
   * A CORRECAO DE 01/09 TROUXE O DEFEITO IRMAO, e ele sobreviveu ate a #279:
   * pegar o MAIOR entre `agora - 1h` e `meia-noite local + 1min` resolve as
   * duas janelas isoladamente, mas se contradiz entre 00:00 e 00:01 local --
   * nesse minuto `meia-noite + 1min` ainda NAO ACONTECEU, ganha o maior, e a
   * entrada nasce no FUTURO. Mesma classe da #279 (que tinha folga de cinco
   * minutos em vez de um), so que nunca observada aqui porque a janela e
   * cinco vezes mais estreita.
   *
   * `instanteDePassagemDeHoje` resolve as duas condicoes por construcao, e
   * tem teste proprio varrendo os 1440 minutos do dia.
   */
  const dentroDoDiaLocal = (): Date => instanteDePassagemDeHoje();

  it('o heartbeat conta as entradas da unidade DESTE totem, e so dela', async () => {
    const quandoEntrou = dentroDoDiaLocal();

    await registrarEntrada(totem.gymUnitId, quandoEntrou);
    await registrarEntrada(totem.gymUnitId, quandoEntrou);
    // A vizinha teve movimento tambem -- e ele NAO pode aparecer aqui.
    await registrarEntrada(unidadeVizinha, quandoEntrou);

    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(CORPO, '/api/v1/kiosk/heartbeat'))
      .send(CORPO)
      .expect(200);

    const { indicadores } = resposta.body as {
      indicadores: { checkinsDeHoje: number; treinandoAgora: number };
    };

    expect(indicadores.checkinsDeHoje).toBe(2);
    expect(indicadores.treinandoAgora).toBe(2);
  });

  it('entrada de ONTEM nao conta como treino em curso', async () => {
    const ontem = new Date(Date.now() - 26 * 60 * 60 * 1000);

    await registrarEntrada(totem.gymUnitId, ontem);

    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(CORPO, '/api/v1/kiosk/heartbeat'))
      .send(CORPO)
      .expect(200);

    const { indicadores } = resposta.body as {
      indicadores: { checkinsDeHoje: number; treinandoAgora: number };
    };

    // A janela de treino e de horas; o dia local, de horas tambem -- mas
    // uma entrada de 26 h atras esta fora das duas.
    expect(indicadores.treinandoAgora).toBe(2);
    expect(indicadores.checkinsDeHoje).toBe(2);
  });

  it('DENY nao conta como check-in', async () => {
    await db.accessEvent.create({
      data: {
        tenantId: totem.tenantId,
        gymUnitId: totem.gymUnitId,
        outcome: 'DENY',
        reason: 'PAYMENT_OVERDUE',
        policyVersion: 'v1',
        mode: 'ONLINE',
        method: 'FACIAL',
        occurredAt: new Date(),
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        detail: {},
      },
    });

    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(CORPO, '/api/v1/kiosk/heartbeat'))
      .send(CORPO)
      .expect(200);

    const { indicadores } = resposta.body as { indicadores: { checkinsDeHoje: number } };

    // Recusa na catraca nao e presenca: contar DENY inflaria o numero que a
    // recepcao exibe ao lado de patrocinador.
    expect(indicadores.checkinsDeHoje).toBe(2);
  });
});
