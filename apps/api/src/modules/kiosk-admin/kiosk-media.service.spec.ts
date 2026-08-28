import { describe, expect, it } from '@jest/globals';

import {
  ErroDoScanner,
  type MalwareScanner,
  type VereditoDoScanner,
} from '../../common/antivirus/malware-scanner.port.js';
import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import {
  ErroDoExtrator,
  type MediaFetcher,
  type ResultadoDaExtracao,
} from '../../common/media-fetcher/media-fetcher.port.js';
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
  readonly extracao?: ResultadoDaExtracao;
  readonly erroDoExtrator?: ErroDoExtrator;
}) {
  const gravados: { key: string; contentType: string }[] = [];
  const escaneados: Uint8Array[] = [];
  const baixados: string[] = [];

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

  const extrator: MediaFetcher = {
    baixar: (url) => {
      baixados.push(url);

      if (opcoes.erroDoExtrator) return Promise.reject(opcoes.erroDoExtrator);

      return Promise.resolve(
        opcoes.extracao ?? { extraido: true, conteudo: mp4(2048), contentType: 'video/mp4' },
      );
    },
  };

  return {
    servico: new KioskMediaService(db, antivirus, storage, extrator),
    gravados,
    escaneados,
    baixados,
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

/*
 * ---------------------------------------------------------------------
 * INGESTAO DE REEL DO INSTAGRAM -- ADR-042, Decisao 7.
 *
 * O ponto de cada teste aqui e provar que o link NAO tem caminho proprio:
 * ele desagua no mesmo fluxo do upload de MP4 (formato -> antivirus ->
 * storage). Um caminho paralelo teria de repetir as tres travas, e a
 * primeira que alguem esquecesse viraria o buraco.
 * ---------------------------------------------------------------------
 */
describe('KioskMediaService.ingerirDeLink', () => {
  const REEL = 'https://www.instagram.com/reel/DbtoWkFR6l6/';

  it('baixa o reel e devolve a chave, como o upload faria', async () => {
    const { servico, gravados, baixados } = montar({});

    const resultado = await servico.ingerirDeLink(contexto, DEVICE, REEL);

    expect(baixados).toEqual([REEL]);
    expect(gravados).toHaveLength(1);
    expect(resultado.midiaKey).toBe(gravados[0]!.key);
  });

  it('NORMALIZA o link antes de baixar -- query de rastreamento nao chega ao extrator', async () => {
    const { servico, baixados } = montar({});

    await servico.ingerirDeLink(
      contexto,
      DEVICE,
      'https://www.instagram.com/reel/DbtoWkFR6l6/?utm_source=ig_web_copy_link',
    );

    expect(baixados).toEqual([REEL]);
  });

  it('devolve a URL canonica junto da chave -- e ela que o bloco guarda', async () => {
    const { servico } = montar({});

    const resultado = await servico.ingerirDeLink(
      contexto,
      DEVICE,
      '  https://instagram.com/reel/DbtoWkFR6l6?utm_source=x  ',
    );

    expect(resultado.linkExterno).toBe(REEL);
  });

  it('ESCANEIA o que baixou -- reel nao pula o antivirus', async () => {
    // A trava que mais importa: mídia de terceiro entrando no bucket sem
    // passar pelo scanner seria pior que o upload, nao melhor.
    const { servico, escaneados } = montar({});

    await servico.ingerirDeLink(contexto, DEVICE, REEL);

    expect(escaneados).toHaveLength(1);
  });

  it('NAO grava no storage quando o antivirus recusa o que veio do Instagram', async () => {
    const { servico, gravados } = montar({
      veredito: { limpo: false, ameaca: 'EICAR-Test-File' },
    });

    const erro = await erroLancadoPor(servico.ingerirDeLink(contexto, DEVICE, REEL));

    expect(erro.code).toBe('FILE_INFECTED');
    expect(gravados).toHaveLength(0);
  });

  it('recusa link que nao e do Instagram SEM chamar o extrator', async () => {
    // SSRF: se a URL chegasse ao extrator, o servidor buscaria o que ela
    // apontasse. A recusa tem de acontecer ANTES do processo externo.
    const { servico, baixados } = montar({});

    const erro = await erroLancadoPor(
      servico.ingerirDeLink(contexto, DEVICE, 'https://exemplo.com/reel/DbtoWkFR6l6/'),
    );

    expect(erro.code).toBe('LINK_NAO_E_DO_INSTAGRAM');
    expect(baixados).toEqual([]);
  });

  it('recusa host que apenas TERMINA em instagram.com, sem chamar o extrator', async () => {
    const { servico, baixados } = montar({});

    await erroLancadoPor(
      servico.ingerirDeLink(contexto, DEVICE, 'https://evil-instagram.com/reel/DbtoWkFR6l6/'),
    );

    expect(baixados).toEqual([]);
  });

  it('traduz reel indisponivel em 422 -- e o gerente troca o link', async () => {
    const { servico } = montar({
      extracao: { extraido: false, motivo: 'MIDIA_INDISPONIVEL' },
    });

    const erro = await erroLancadoPor(servico.ingerirDeLink(contexto, DEVICE, REEL));

    expect(erro).toMatchObject({ code: 'MIDIA_INDISPONIVEL', status: 422 });
  });

  it('traduz extrator quebrado em 503 -- e NAO em erro do link', async () => {
    // A distincao que o ADR exige: no dia em que a Meta mudar e a extracao
    // parar para TODO reel, o painel precisa dizer "a ferramenta falhou".
    // Dizer "seu link esta errado" faria o gerente trocar de link para
    // sempre atras de um defeito que nao e dele.
    const { servico } = montar({
      erroDoExtrator: new ErroDoExtrator('EXTRATOR_FALHOU', 'quebrou'),
    });

    const erro = await erroLancadoPor(servico.ingerirDeLink(contexto, DEVICE, REEL));

    expect(erro.status).toBe(503);
    expect(erro.code).toBe('EXTRATOR_FALHOU');
  });

  it('traduz extrator ausente em 503', async () => {
    const { servico } = montar({
      erroDoExtrator: new ErroDoExtrator('EXTRATOR_INDISPONIVEL', 'sem binario'),
    });

    expect((await erroLancadoPor(servico.ingerirDeLink(contexto, DEVICE, REEL))).status).toBe(503);
  });

  it('recusa midia grande demais sem gravar', async () => {
    const { servico, gravados } = montar({
      extracao: { extraido: false, motivo: 'MIDIA_GRANDE_DEMAIS' },
    });

    const erro = await erroLancadoPor(servico.ingerirDeLink(contexto, DEVICE, REEL));

    expect(erro.code).toBe('MIDIA_GRANDE_DEMAIS');
    expect(gravados).toHaveLength(0);
  });

  it('aplica a MESMA validacao de formato do upload', async () => {
    // O extrator promete MP4, mas quem prova o formato sao os bytes. Se um
    // dia ele devolver outra coisa, a assinatura de arquivo recusa -- a
    // mesma trava que o upload tem.
    const naoEhMp4 = new Uint8Array(1024);
    naoEhMp4.set([0x25, 0x50, 0x44, 0x46], 0); // %PDF

    const { servico, gravados } = montar({
      extracao: { extraido: true, conteudo: naoEhMp4, contentType: 'video/mp4' },
    });

    await erroLancadoPor(servico.ingerirDeLink(contexto, DEVICE, REEL));

    expect(gravados).toHaveLength(0);
  });

  it('device de outro tenant responde 404 antes de baixar qualquer coisa', async () => {
    const { servico, baixados } = montar({ deviceExiste: false });

    await expect(servico.ingerirDeLink(contexto, DEVICE, REEL)).rejects.toMatchObject({
      status: 404,
    });
    expect(baixados).toEqual([]);
  });
});
