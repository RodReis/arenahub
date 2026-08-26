import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { CONFIG_PADRAO_DO_TOTEM } from '@arenahub/api-contracts';

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
        payload: CONFIG_PADRAO_DO_TOTEM as unknown as object,
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
          payload: CONFIG_PADRAO_DO_TOTEM as unknown as object,
        },
      });

    await expect(publicada(10)).resolves.toBeDefined();
    await expect(publicada(11)).resolves.toBeDefined();
  });
});
