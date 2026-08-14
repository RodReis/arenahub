import { describe, expect, it } from '@jest/globals';

import { carregarConfig, descreverConfig, ConfigInvalidaError } from './env.js';

const VALIDO = {
  EDGE_AGENT_ID: 'bancada-01',
  TENANT_ID: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  GYM_UNIT_ID: '9c858901-8a57-4791-81fe-4c455b099bc9',
};

describe('carregarConfig', () => {
  it('aceita a configuracao minima e aplica os padroes', () => {
    const config = carregarConfig(VALIDO);

    expect(config.EDGE_AGENT_ID).toBe('bancada-01');
    expect(config.LOG_LEVEL).toBe('info');
    // M0-NFR-006: o simulador tem de rodar em CI sem hardware, entao quem
    // nao configura nada nao precisa de equipamento.
    expect(config.USE_SIMULATOR).toBe(true);
  });

  it('rejeita tenant que nao e uuid', () => {
    expect(() => carregarConfig({ ...VALIDO, TENANT_ID: 'academia-1' })).toThrow(
      ConfigInvalidaError,
    );
  });

  it('lista TODOS os problemas de uma vez, nao so o primeiro', () => {
    // Corrigir um erro por vez, reiniciando o processo a cada tentativa, e o
    // que faz alguem desistir do runbook.
    try {
      carregarConfig({ EDGE_AGENT_ID: '', TENANT_ID: 'x', GYM_UNIT_ID: 'y' });
      throw new Error('deveria ter falhado');
    } catch (erro: unknown) {
      expect(erro).toBeInstanceOf(ConfigInvalidaError);
      expect((erro as ConfigInvalidaError).problemas.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('aceita USE_SIMULATOR como string, porque variavel de ambiente e string', () => {
    expect(carregarConfig({ ...VALIDO, USE_SIMULATOR: 'false' }).USE_SIMULATOR).toBe(false);
    expect(carregarConfig({ ...VALIDO, USE_SIMULATOR: 'true' }).USE_SIMULATOR).toBe(true);
  });

  it('nao coloca o valor recebido na mensagem de erro', () => {
    // M0-NFR-005: um segredo malformado ainda e um segredo. A mensagem diz o
    // que esta errado, nunca o que foi recebido.
    const segredo = 'hmac-secreto-que-nao-pode-vazar';
    try {
      carregarConfig({ ...VALIDO, COLLECTOR_HMAC_SECRET: '' , COLLECTOR_URL: segredo });
      throw new Error('deveria ter falhado');
    } catch (erro: unknown) {
      expect((erro as ConfigInvalidaError).message).not.toContain(segredo);
    }
  });
});

describe('descreverConfig', () => {
  it('mascara segredo presente', () => {
    const config = carregarConfig({
      ...VALIDO,
      COLLECTOR_URL: 'https://coletor.exemplo',
      COLLECTOR_HMAC_SECRET: 'nao-pode-aparecer',
    });

    const visao = descreverConfig(config);

    expect(visao['COLLECTOR_HMAC_SECRET']).toBe('***');
    expect(JSON.stringify(visao)).not.toContain('nao-pode-aparecer');
  });

  it('distingue segredo ausente de segredo mascarado', () => {
    // "nao configurei" e "configurei errado" sao problemas diferentes.
    // Esconder os dois do mesmo jeito atrapalha o diagnostico sem proteger
    // nada a mais.
    const visao = descreverConfig(carregarConfig(VALIDO));

    expect(visao['COLLECTOR_HMAC_SECRET']).toBe('(nao definido)');
  });

  it('mantem legivel o que nao e segredo', () => {
    const visao = descreverConfig(carregarConfig(VALIDO));

    expect(visao['EDGE_AGENT_ID']).toBe('bancada-01');
    expect(visao['TENANT_ID']).toBe(VALIDO.TENANT_ID);
  });
});
