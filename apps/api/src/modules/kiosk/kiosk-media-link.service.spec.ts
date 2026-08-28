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

/**
 * LOGOTIPO DE PATROCINADOR SEGUE O MESMO CAMINHO DO VIDEO (28/08/2026).
 *
 * O campo era `logotipoUrl` -- endereco externo que o totem punha direto no
 * `<img src>`. Virou `logotipoKey` por decisao do PI, e chave de storage nao
 * carrega em `<img>`: precisa da mesma assinatura no boot que o video ja
 * tinha.
 *
 * As tres garantias sao as MESMAS, e nao por simetria estetica: sao os tres
 * modos de falha que ja custaram caro neste servico -- chave de outro
 * tenant, storage fora do ar, e chave preservada na resposta.
 */
describe('logotipo do patrocinador vira URL assinada', () => {
  const marca = (logotipoKey: string | null) => ({ nome: 'Suplementos', logotipoKey });

  function comPatrocinio(marcas: readonly { nome: string; logotipoKey: string | null }[]) {
    return {
      version: 3,
      config: {
        ...CONFIG_PADRAO_DO_TOTEM,
        patrocinio: { habilitado: true, rotulo: '', marcas: [...marcas] },
      },
    };
  }

  it('assina a chave que pertence ao tenant e a unidade', async () => {
    const { servico } = montar();
    const chave = `tenants/${TENANT}/kiosk-media/${UNIDADE}/logo.png`;

    const saida = await servico.resolverMidias(contexto, comPatrocinio([marca(chave)]));

    expect(saida.config.patrocinio.marcas[0]?.logotipoUrlAssinada).toContain('assinado');
  });

  /*
   * A CHAVE SOBREVIVE na resposta -- so a URL e derivada. Zera-la faria uma
   * falha temporaria do storage virar perda permanente do logotipo na
   * proxima gravacao do rascunho pelo painel.
   */
  it('preserva a chave ao lado da URL', async () => {
    const { servico } = montar();
    const chave = `tenants/${TENANT}/kiosk-media/${UNIDADE}/logo.png`;

    const saida = await servico.resolverMidias(contexto, comPatrocinio([marca(chave)]));

    expect(saida.config.patrocinio.marcas[0]?.logotipoKey).toBe(chave);
  });

  it('recusa chave de OUTRO tenant sem assinar', async () => {
    const { servico, assinadas } = montar();
    const alheia = `tenants/OUTRO/kiosk-media/${UNIDADE}/logo.png`;

    const saida = await servico.resolverMidias(contexto, comPatrocinio([marca(alheia)]));

    expect(saida.config.patrocinio.marcas[0]?.logotipoUrlAssinada).toBeNull();
    expect(assinadas).not.toContain(alheia);
  });

  /** Storage fora do ar cai no nome, nao derruba a faixa nem a tela. */
  it('devolve null quando o storage falha', async () => {
    const { servico } = montar({ falha: true });
    const chave = `tenants/${TENANT}/kiosk-media/${UNIDADE}/logo.png`;

    const saida = await servico.resolverMidias(contexto, comPatrocinio([marca(chave)]));

    expect(saida.config.patrocinio.marcas[0]?.logotipoUrlAssinada).toBeNull();
  });

  /*
   * O que importa e NAO ASSINAR -- nao a forma do campo vazio.
   *
   * Sem nenhuma chave (e sem video), `resolverMidias` devolve a config
   * ORIGINAL pelo atalho, entao `logotipoUrlAssinada` fica `undefined` e nao
   * `null`. Os dois sao ausencia, e o totem trata os dois igual (`!= null`
   * na faixa). Exigir `null` aqui obrigaria a copiar toda a config no caso
   * mais comum da tela publica -- custo real para uniformizar o que ninguem
   * distingue.
   */
  it('nao chama o storage para marca sem logotipo', async () => {
    const { servico, assinadas } = montar();

    const saida = await servico.resolverMidias(contexto, comPatrocinio([marca(null)]));

    expect(assinadas).toHaveLength(0);
    expect(saida.config.patrocinio.marcas[0]?.logotipoUrlAssinada ?? null).toBeNull();
  });

  /*
   * A marca SEM logotipo, ao lado de uma COM, passa pelo caminho longo -- e
   * ai `null` explicito e obrigatorio, senao o campo viria undefined de um
   * objeto que o servico de fato reescreveu.
   */
  it('zera a marca sem logotipo quando outra tem', async () => {
    const { servico } = montar();
    const chave = `tenants/${TENANT}/kiosk-media/${UNIDADE}/logo.png`;

    const saida = await servico.resolverMidias(
      contexto,
      comPatrocinio([marca(chave), marca(null)]),
    );

    expect(saida.config.patrocinio.marcas[1]?.logotipoUrlAssinada).toBeNull();
  });
});
