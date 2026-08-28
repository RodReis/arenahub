import { beforeEach, describe, expect, it } from '@jest/globals';

import { EngagementService } from './engagement.service.js';
import { RepositorioEmMemoria } from './engagement.repository.fake.js';

const TENANT = 'tenant-a';
const OUTRO_TENANT = 'tenant-b';

describe('EngagementService -- configuracao do tenant (F35)', () => {
  let porta: RepositorioEmMemoria;
  let service: EngagementService;

  beforeEach(() => {
    porta = new RepositorioEmMemoria();
    service = new EngagementService(porta);
  });

  it('tenant novo vem com tudo LIGADO e sem teto', async () => {
    // A fatia nao desliga nada de quem ja esta rodando: ligado e o estado que
    // as F31, F32 e F34 entregaram. A flag existe para poder DESLIGAR, nao
    // para exigir que alguem lembre de ligar.
    const config = await service.obterConfiguracao(TENANT);

    expect(config).toEqual({
      rankingEnabled: true,
      challengesEnabled: true,
      achievementsEnabled: true,
      correctionLimitPoints: null,
    });
  });

  it('desliga uma capacidade sem tocar nas outras', async () => {
    await service.salvarConfiguracao(TENANT, { challengesEnabled: false });

    const config = await service.obterConfiguracao(TENANT);

    expect(config.challengesEnabled).toBe(false);
    expect(config.rankingEnabled).toBe(true);
    expect(config.achievementsEnabled).toBe(true);
  });

  it('religar devolve a capacidade -- desligar nao apaga nada', async () => {
    await service.salvarConfiguracao(TENANT, { rankingEnabled: false });
    await service.salvarConfiguracao(TENANT, { rankingEnabled: true });

    expect((await service.obterConfiguracao(TENANT)).rankingEnabled).toBe(true);
  });

  it('grava o teto de correcao', async () => {
    await service.salvarConfiguracao(TENANT, { correctionLimitPoints: 100 });

    expect((await service.obterConfiguracao(TENANT)).correctionLimitPoints).toBe(100);
  });

  it('teto NULO e valido e significa sem teto -- distinto de zero', async () => {
    await service.salvarConfiguracao(TENANT, { correctionLimitPoints: 0 });
    expect((await service.obterConfiguracao(TENANT)).correctionLimitPoints).toBe(0);

    await service.salvarConfiguracao(TENANT, { correctionLimitPoints: null });
    expect((await service.obterConfiguracao(TENANT)).correctionLimitPoints).toBeNull();
  });

  it('recusa teto negativo -- teto e limite, nao valor', async () => {
    await expect(
      service.salvarConfiguracao(TENANT, { correctionLimitPoints: -10 }),
    ).rejects.toMatchObject({ response: { code: 'TETO_INVALIDO' } });
  });

  it('O CANARIO DE TENANT: configuracao de um nao vaza para o outro', async () => {
    await service.salvarConfiguracao(TENANT, { rankingEnabled: false });

    expect((await service.obterConfiguracao(OUTRO_TENANT)).rankingEnabled).toBe(true);
  });
});
