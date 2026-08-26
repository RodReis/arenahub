import { describe, expect, it } from '@jest/globals';

import { CONFIG_PADRAO_DO_TOTEM, resolverConfig } from './kiosk-config.js';

describe('resolverConfig -- tres camadas, a mais especifica vence', () => {
  it('devolve o padrao quando nenhuma camada existe', () => {
    expect(resolverConfig({})).toEqual(CONFIG_PADRAO_DO_TOTEM);
  });

  it('a unidade sobrescreve o tenant', () => {
    const resultado = resolverConfig({
      tenant: { sessao: { duracaoSegundos: 45 } },
      unidade: { sessao: { duracaoSegundos: 90 } },
    });

    expect(resultado.sessao.duracaoSegundos).toBe(90);
  });

  it('o dispositivo sobrescreve a unidade', () => {
    const resultado = resolverConfig({
      unidade: { sessao: { duracaoSegundos: 90 } },
      dispositivo: { sessao: { duracaoSegundos: 120 } },
    });

    expect(resultado.sessao.duracaoSegundos).toBe(120);
  });

  it('campo ausente na camada especifica NAO apaga o da camada de baixo', () => {
    const resultado = resolverConfig({
      unidade: { marca: { nomeDaAcademia: 'Arena Centro' } },
      dispositivo: { sessao: { duracaoSegundos: 120 } },
    });

    // O dispositivo falou so de sessao -- a marca da unidade sobrevive.
    expect(resultado.marca.nomeDaAcademia).toBe('Arena Centro');
    expect(resultado.sessao.duracaoSegundos).toBe(120);
  });

  it('camada invalida e IGNORADA, nao derruba a resolucao', () => {
    const resultado = resolverConfig({
      unidade: { sessao: { duracaoSegundos: 'noventa' } },
    });

    expect(resultado.sessao.duracaoSegundos).toBe(
      CONFIG_PADRAO_DO_TOTEM.sessao.duracaoSegundos,
    );
  });

  it('nenhum modulo vem habilitado na F49', () => {
    expect(CONFIG_PADRAO_DO_TOTEM.modulos).toEqual({
      pagamento: false,
      historicoDePagamentos: false,
      avaliacao: false,
      evolucao: false,
      historicoDeAvaliacoes: false,
      ranking: false,
    });
  });

  it('o unico metodo de identificacao habilitado e o CPF', () => {
    expect(CONFIG_PADRAO_DO_TOTEM.identificacao).toEqual({
      cpf: true,
      facial: false,
      qrCodeDoApp: false,
    });
  });
});
