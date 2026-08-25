import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { assinar } from '@arenahub/api-contracts';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { KioskAuthService } from '../../src/modules/kiosk-auth/kiosk-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F49, Task 3 -- assinatura do totem.
 *
 * Cada teste e um ATAQUE. O caminho feliz e um; os outros seis sao o motivo
 * de o mecanismo existir.
 */
describe('F49 -- assinatura do totem', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const CORPO = { agentVersion: '0.1.0', localTimeMs: 0 };

  const assinarPedido = (
    corpo: unknown,
    ajuste: { timestamp?: number; nonce?: string } = {},
  ): Record<string, string> => {
    const body = JSON.stringify(corpo);
    const timestamp = ajuste.timestamp ?? Math.floor(Date.now() / 1000);
    const nonce = ajuste.nonce ?? randomUUID();

    return {
      'x-kiosk-key-id': totem.keyId,
      'x-kiosk-timestamp': String(timestamp),
      'x-kiosk-nonce': nonce,
      'x-kiosk-signature': assinar(
        {
          keyId: totem.keyId,
          timestamp,
          nonce,
          method: 'POST',
          pathAndQuery: '/api/v1/kiosk/heartbeat',
          body,
        },
        totem.segredo,
      ),
    };
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = modulo.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `kiosk-${sufixo}`,
        legalName: 'Kiosk LTDA',
        displayName: 'Kiosk',
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
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `TOTEM-${sufixo}` },
    });

    const segredo = randomBytes(32).toString('hex');
    const keyId = `kiosk-${sufixo}`;

    await db.kioskCredential.create({
      data: {
        tenantId: tenant.id,
        kioskDeviceId: dispositivo.id,
        keyId,
        encryptedSecret: app.get(KioskAuthService).cifrarSegredo(segredo),
        activeFrom: new Date(Date.now() - 60_000),
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

  it('aceita requisicao assinada corretamente', async () => {
    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(CORPO))
      .send(CORPO)
      .expect(200);
  });

  it('recusa corpo adulterado depois de assinado', async () => {
    const cabecalhos = assinarPedido(CORPO);

    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(cabecalhos)
      .send({ ...CORPO, agentVersion: '9.9.9' })
      .expect(401);
  });

  it('recusa relogio fora da janela', async () => {
    const antigo = Math.floor(Date.now() / 1000) - 400;

    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(CORPO, { timestamp: antigo }))
      .send(CORPO)
      .expect(401);
  });

  it('recusa nonce repetido', async () => {
    const nonce = randomUUID();

    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(CORPO, { nonce }))
      .send(CORPO)
      .expect(200);

    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(CORPO, { nonce }))
      .send(CORPO)
      .expect(401);
  });

  it('recusa chave desconhecida', async () => {
    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set({ ...assinarPedido(CORPO), 'x-kiosk-key-id': 'nao-existe' })
      .send(CORPO)
      .expect(401);
  });

  it('recusa credencial revogada', async () => {
    await db.kioskCredential.updateMany({
      where: { keyId: totem.keyId },
      data: { revokedAt: new Date() },
    });

    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(CORPO))
      .send(CORPO)
      .expect(401);

    await db.kioskCredential.updateMany({
      where: { keyId: totem.keyId },
      data: { revokedAt: null },
    });
  });

  it('recusa requisicao sem assinatura', async () => {
    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .send(CORPO)
      .expect(401);
  });
});
