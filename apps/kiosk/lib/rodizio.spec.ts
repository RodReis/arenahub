import { describe, expect, it } from 'vitest';
import {
  CONFIG_PADRAO_DO_TOTEM,
  type BlocoDaTelaPublica,
  type KioskConfig,
} from '@arenahub/api-contracts';

import { blocosVisiveis, indiceSeguro, proximoIndice } from './rodizio';

function video(overrides: Partial<Extract<BlocoDaTelaPublica, { tipo: 'VIDEO' }>>): BlocoDaTelaPublica {
  return {
    id: 'v',
    habilitado: true,
    tipo: 'VIDEO',
    titulo: 'Video',
    legenda: 'Legenda',
    midiaKey: 'tenants/t/kiosk-media/u/a.mp4',
    linkExterno: null,
    ...overrides,
  };
}

const instagram: BlocoDaTelaPublica = {
  id: 'i',
  habilitado: true,
  tipo: 'INSTAGRAM',
  perfil: '@arena',
  chamada: 'Siga',
};

function comBlocos(itens: readonly BlocoDaTelaPublica[]): KioskConfig {
  return {
    ...CONFIG_PADRAO_DO_TOTEM,
    blocos: { tempoPorBlocoSegundos: 12, itens: [...itens] },
  };
}

describe('blocosVisiveis', () => {
  it('leva so os habilitados, na ordem publicada', () => {
    const config = comBlocos([{ ...instagram, habilitado: false }, video({ midiaUrl: 'https://x' })]);

    expect(blocosVisiveis(config).map((b) => b.id)).toEqual(['v']);
  });

  it('video SEM url resolvida sai do rodizio -- nada de 12 s de tela preta', () => {
    expect(blocosVisiveis(comBlocos([video({ midiaUrl: null })]))).toEqual([]);
    expect(blocosVisiveis(comBlocos([video({})]))).toEqual([]);
    expect(blocosVisiveis(comBlocos([video({ midiaUrl: '' })]))).toEqual([]);
  });

  it('video com url resolvida entra, mesmo que a chave tenha sido preservada', () => {
    const config = comBlocos([video({ midiaUrl: 'https://storage/x?assinado' })]);

    expect(blocosVisiveis(config)).toHaveLength(1);
  });

  it('bloco de texto nao depende de midia nenhuma', () => {
    expect(blocosVisiveis(comBlocos([instagram]))).toHaveLength(1);
  });

  it('config sem blocos devolve lista vazia, e nao quebra', () => {
    expect(blocosVisiveis(CONFIG_PADRAO_DO_TOTEM)).toEqual([]);
  });
});

describe('proximoIndice', () => {
  it('gira em circulo', () => {
    expect(proximoIndice(0, 3)).toBe(1);
    expect(proximoIndice(2, 3)).toBe(0);
  });

  it('lista vazia devolve 0, nunca NaN', () => {
    // `% 0` e NaN, e `itens[NaN]` e `undefined` -- tela em branco sem erro.
    expect(proximoIndice(0, 0)).toBe(0);
    expect(Number.isNaN(proximoIndice(5, 0))).toBe(false);
  });

  it('bloco unico fica nele mesmo', () => {
    expect(proximoIndice(0, 1)).toBe(0);
  });
});

describe('indiceSeguro', () => {
  it('preserva o indice que ainda cabe', () => {
    expect(indiceSeguro(1, 3)).toBe(1);
  });

  it('lista que ENCOLHEU volta ao inicio', () => {
    expect(indiceSeguro(4, 2)).toBe(0);
  });

  it('lista vazia devolve 0', () => {
    expect(indiceSeguro(3, 0)).toBe(0);
  });
});

describe('bloco de DESAFIO (F34, ADR-048 emenda 2)', () => {
  const base = { id: 'b1', habilitado: true } as const;

  /**
   * Sem desafio aberto o bloco SAI da lista -- mesma regra do VIDEO sem
   * midia. Bloco de campanha vazio na parede e pior que bloco ausente: o
   * carrossel pararia num quadro que so tem titulo.
   */
  it('sai da lista quando nao ha desafio em cartaz', () => {
    const config = comBlocos([{ ...base, tipo: 'DESAFIO', titulo: 'Desafio do mês' }]);

    expect(blocosVisiveis(config, null)).toEqual([]);
  });

  it('entra quando ha desafio em cartaz', () => {
    const config = comBlocos([{ ...base, tipo: 'DESAFIO', titulo: 'Desafio do mês' }]);

    const visiveis = blocosVisiveis(config, {
      titulo: 'Setembro Ativo',
      meta: 8,
      diasRestantes: 5,
    });

    expect(visiveis).toHaveLength(1);
  });

  it('bloco desabilitado nao entra, mesmo com desafio em cartaz', () => {
    const config = comBlocos([
      { ...base, habilitado: false, tipo: 'DESAFIO', titulo: 'Desafio do mês' },
    ]);

    expect(
      blocosVisiveis(config, { titulo: 'Setembro Ativo', meta: 8, diasRestantes: 5 }),
    ).toEqual([]);
  });

  it('os outros tipos nao dependem do desafio', () => {
    const config = comBlocos([{ ...base, tipo: 'INSTAGRAM', perfil: '@x', chamada: 'siga' }]);

    expect(blocosVisiveis(config, null)).toHaveLength(1);
  });
});
