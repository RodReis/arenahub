import { describe, expect, it } from '@jest/globals';

import {
  ErroDoScanner,
  type MalwareScanner,
  type VereditoDoScanner,
} from '../../common/antivirus/malware-scanner.port.js';
import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { ObjectStoragePort } from '../../common/storage/object-storage.port.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { PrismaService } from '../../persistence/prisma.service.js';
import { KioskMediaService } from './kiosk-media.service.js';

const TENANT = 't-1';
const UNIDADE = 'u-1';
const DEVICE = 'd-1';

const contexto = { tenantId: TENANT } as TenantContext;

function mp4(tamanhoBytes = 1024): Uint8Array {
  const bytes = new Uint8Array(tamanhoBytes);

  bytes.set([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);

  return bytes;
}

/**
 * Dublês montados por teste, NUNCA compartilhados entre eles: dublê com
 * estado guardado no `describe` vaza modo ligado de um bloco para o
 * seguinte.
 */
function montar(opcoes: {
  readonly veredito?: VereditoDoScanner;
  readonly erroDoScanner?: ErroDoScanner;
  readonly deviceExiste?: boolean;
}) {
  const gravados: { key: string; contentType: string }[] = [];
  const escaneados: Uint8Array[] = [];

  const db = {
    kioskDevice: {
      findFirst: () =>
        Promise.resolve(
          opcoes.deviceExiste === false ? null : { id: DEVICE, gymUnitId: UNIDADE },
        ),
    },
  } as unknown as PrismaService;

  const antivirus: MalwareScanner = {
    escanear: (conteudo) => {
      escaneados.push(conteudo);

      if (opcoes.erroDoScanner) return Promise.reject(opcoes.erroDoScanner);

      return Promise.resolve(opcoes.veredito ?? { limpo: true });
    },
  };

  const storage = {
    putPrivateObject: (entrada: { key: string; contentType: string }) => {
      gravados.push({ key: entrada.key, contentType: entrada.contentType });

      return Promise.resolve();
    },
    createPrivateDownload: (entrada: { key: string }) =>
      Promise.resolve({
        downloadUrl: `https://storage.local/${entrada.key}?assinado`,
        expiresAt: '2026-08-26T13:00:00.000Z',
      }),
  } as unknown as ObjectStoragePort;

  return {
    servico: new KioskMediaService(db, antivirus, storage),
    gravados,
    escaneados,
  };
}

function midia(conteudo: Uint8Array, contentType = 'video/mp4') {
  return { originalFilename: 'video.mp4', contentType, conteudo };
}

/**
 * O `ErroDeDominio` que a promessa lancou.
 *
 * FALHA quando nada e lancado, em vez de devolver o valor de sucesso: um
 * `.catch(e => e)` solto faz o teste seguir com o objeto de sucesso na mao,
 * e a assercao seguinte passa a comparar `undefined` com `undefined`.
 */
async function erroLancadoPor(promessa: Promise<unknown>): Promise<ErroDeDominio> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroDeDominio) return erro;

    throw erro;
  }

  throw new Error('esperava ErroDeDominio, mas a operacao teve sucesso');
}

describe('KioskMediaService.enviar', () => {
  it('grava o MP4 limpo com chave gerada pelo servidor', async () => {
    const { servico, gravados } = montar({});

    const { midiaKey } = await servico.enviar(contexto, DEVICE, midia(mp4()));

    expect(midiaKey).toMatch(
      new RegExp(`^tenants/${TENANT}/kiosk-media/${UNIDADE}/[0-9a-f-]{36}\\.mp4$`),
    );
    expect(gravados).toEqual([{ key: midiaKey, contentType: 'video/mp4' }]);
  });

  it('ESCANEIA ANTES de gravar -- arquivo infectado nao chega ao storage', async () => {
    const { servico, gravados, escaneados } = montar({
      veredito: { limpo: false, ameaca: 'EICAR-Test-File' },
    });

    await expect(servico.enviar(contexto, DEVICE, midia(mp4()))).rejects.toMatchObject({
      code: 'FILE_INFECTED',
      status: 422,
    });

    // A prova de que a ordem esta certa: o scanner rodou E o storage nao.
    expect(escaneados).toHaveLength(1);
    expect(gravados).toEqual([]);
  });

  it('nao vaza o nome da ameaca na mensagem devolvida ao gerente', async () => {
    const { servico } = montar({ veredito: { limpo: false, ameaca: 'Trojan.Generic.42' } });

    const erro = await erroLancadoPor(servico.enviar(contexto, DEVICE, midia(mp4())));

    expect(erro.title).not.toContain('Trojan');
  });

  it('scanner FORA DO AR responde 503, e o arquivo NAO entra no storage', async () => {
    const { servico, gravados } = montar({
      erroDoScanner: new ErroDoScanner('SCANNER_UNAVAILABLE', 'fora do ar'),
    });

    await expect(servico.enviar(contexto, DEVICE, midia(mp4()))).rejects.toMatchObject({
      code: 'SCANNER_UNAVAILABLE',
      status: 503,
    });
    expect(gravados).toEqual([]);
  });

  it('scanner fora do ar e arquivo infectado sao codigos DIFERENTES', async () => {
    const fora = montar({ erroDoScanner: new ErroDoScanner('SCANNER_TIMEOUT', 'demorou') });
    const infectado = montar({ veredito: { limpo: false, ameaca: 'X' } });

    const erroFora = await erroLancadoPor(fora.servico.enviar(contexto, DEVICE, midia(mp4())));
    const erroInfectado = await erroLancadoPor(
      infectado.servico.enviar(contexto, DEVICE, midia(mp4())),
    );

    expect(erroFora.code).not.toBe(erroInfectado.code);
    expect(erroFora.status).toBe(503);
    expect(erroInfectado.status).toBe(422);
  });

  it('recusa PNG disfarcado de MP4 SEM sequer chamar o antivirus', async () => {
    const { servico, escaneados, gravados } = montar({});
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

    await expect(servico.enviar(contexto, DEVICE, midia(png))).rejects.toMatchObject({
      code: 'FILE_SIGNATURE_MISMATCH',
    });
    expect(escaneados).toEqual([]);
    expect(gravados).toEqual([]);
  });

  it('device de outro tenant responde 404, nunca 403', async () => {
    const { servico } = montar({ deviceExiste: false });

    await expect(servico.enviar(contexto, DEVICE, midia(mp4()))).rejects.toMatchObject({
      status: 404,
    });
  });
});
