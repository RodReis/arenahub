import { describe, expect, it } from '@jest/globals';

import { montarDispositivos } from './montar-dispositivos.js';
import { carregarConfig } from '../config/env.js';
import { criarLogger } from '../observability/logger.js';
import { FacialSimulator } from '../adapters/facial-simulator.js';
import { TurnstileSimulator } from '../adapters/turnstile-simulator.js';

const baseEnv = {
  EDGE_AGENT_ID: 'edge-1',
  TENANT_ID: '11111111-1111-4111-8111-111111111111',
  GYM_UNIT_ID: '22222222-2222-4222-8222-222222222222',
};

describe('montarDispositivos', () => {
  it('monta os dois simuladores quando os flags sao simulador (padrao)', async () => {
    const config = carregarConfig(baseEnv);
    const logger = criarLogger(config);

    const montado = await montarDispositivos(config, logger);

    expect(montado.facial).toBeInstanceOf(FacialSimulator);
    expect(montado.catraca).toBeInstanceOf(TurnstileSimulator);

    await montado.encerrar();
  });

  it('encerrar() e idempotente e nao lanca', async () => {
    const config = carregarConfig(baseEnv);
    const logger = criarLogger(config);
    const montado = await montarDispositivos(config, logger);

    await montado.encerrar();
    await expect(montado.encerrar()).resolves.not.toThrow();
  });
});
