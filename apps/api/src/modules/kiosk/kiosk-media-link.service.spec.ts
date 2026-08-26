import { describe, expect, it } from '@jest/globals';
import { CONFIG_PADRAO_DO_TOTEM, type BlocoDaTelaPublica } from '@arenahub/api-contracts';

import type { ObjectStoragePort } from '../../common/storage/object-storage.port.js';
import type { ContextoDoKiosk } from '../kiosk-auth/kiosk-auth.service.js';
import { KioskMediaLinkService } from './kiosk-media-link.service.js';

const TENANT = 't-1';
const UNIDADE = 'u-1';

const contexto = {
  tenantId: TENANT,
  gymUnitId: UNIDADE,
  kioskDeviceId: 'd-1',
} as ContextoDoKiosk;

function video(midiaKey: string | null): BlocoDaTelaPublica {
  return {
    id: 'v1',
    habilitado: true,
    tipo: 'VIDEO',
    titulo: 'Nossa equipe',
    legenda: 'Conheca os professores.',
    midiaKey,
    linkExterno: null,
  };
}

const instagram: BlocoDaTelaPublica = {
  id: 'i1',
  habilitado: true,
  tipo: 'INSTAGRAM',
  perfil: '@arena',
  chamada: 'Siga a gente',
};

function montar(opcoes: { readonly falha?: boolean } = {}) {
  const assinadas: string[] = [];

  const storage = {
    createPrivateDownload: (entrada: { key: string }) => {
      assinadas.push(entrada.key);

      if (opcoes.falha) return Promise.reject(new Error('storage fora do ar'));

      return Promise.resolve({
        downloadUrl: `https://storage.local/${entrada.key}?assinado`,
        expiresAt: '2026-08-26T13:00:00.000Z',
      });
    },
  } as unknown as ObjectStoragePort;

  return { servico: new KioskMediaLinkService(storage), assinadas };
}

function comBlocos(itens: readonly BlocoDaTelaPublica[]) {
  return {
    version: 3,
    config: {
      ...CONFIG_PADRAO_DO_TOTEM,
      blocos: { tempoPorBlocoSegundos: 12 as const, itens: [...itens] },
    },
  };
}

describe('KioskMediaLinkService.resolverMidias', () => {
  it('assina a chave da propria unidade e preenche `midiaUrl`', async () => {
    const { servico } = montar();
    const chave = `tenants/${TENANT}/kiosk-media/${UNIDADE}/abc.mp4`;

    const { config } = await servico.resolverMidias(contexto, comBlocos([video(chave)]));
    const bloco = config.blocos.itens[0];

    expect(bloco).toMatchObject({ midiaUrl: `https://storage.local/${chave}?assinado` });
    // A CHAVE sobrevive: quem a apaga e o painel, nunca esta resolucao.
    expect(bloco).toMatchObject({ midiaKey: chave });
  });

  it('chave de OUTRO tenant nao vira URL, mesmo gravada no payload', async () => {
    const { servico, assinadas } = montar();
    const chave = `tenants/outro/kiosk-media/${UNIDADE}/abc.mp4`;

    const { config } = await servico.resolverMidias(contexto, comBlocos([video(chave)]));

    expect(config.blocos.itens[0]).toMatchObject({ midiaUrl: null });
    // Nem chegou a pedir assinatura -- a recusa e antes do storage.
    expect(assinadas).toEqual([]);
  });

  it('unidade que e PREFIXO de outra nao alcanca a midia dela', async () => {
    const { servico, assinadas } = montar();
    const chave = `tenants/${TENANT}/kiosk-media/${UNIDADE}0/abc.mp4`;

    const { config } = await servico.resolverMidias(contexto, comBlocos([video(chave)]));

    expect(config.blocos.itens[0]).toMatchObject({ midiaUrl: null });
    expect(assinadas).toEqual([]);
  });

  it('storage fora do ar zera SO a URL, e preserva a chave e os outros blocos', async () => {
    const { servico } = montar({ falha: true });
    const chave = `tenants/${TENANT}/kiosk-media/${UNIDADE}/abc.mp4`;

    const { config } = await servico.resolverMidias(
      contexto,
      comBlocos([video(chave), instagram]),
    );

    expect(config.blocos.itens[0]).toMatchObject({ midiaUrl: null, midiaKey: chave });
    expect(config.blocos.itens[1]).toEqual(instagram);
  });

  it('bloco sem video nenhum nao chama o storage', async () => {
    const { servico, assinadas } = montar();

    const { config } = await servico.resolverMidias(contexto, comBlocos([instagram]));

    expect(assinadas).toEqual([]);
    expect(config.blocos.itens).toEqual([instagram]);
  });

  it('video que so tem link externo (sem chave) passa intacto', async () => {
    const { servico, assinadas } = montar();

    const { config } = await servico.resolverMidias(contexto, comBlocos([video(null)]));

    expect(assinadas).toEqual([]);
    expect(config.blocos.itens[0]).toEqual(video(null));
  });

  it('preserva a versao -- resolver midia nao e publicar', async () => {
    const { servico } = montar();
    const entrada = comBlocos([video(`tenants/${TENANT}/kiosk-media/${UNIDADE}/a.mp4`)]);

    const { version } = await servico.resolverMidias(contexto, entrada);

    expect(version).toBe(entrada.version);
  });
});
