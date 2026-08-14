import { describe, expect, it } from '@jest/globals';

import { carregarConfig } from '../config/env.js';
import { componenteProcesso, montarHeartbeat, type Componente } from './health-check.js';

const config = carregarConfig({
  EDGE_AGENT_ID: 'bancada-01',
  TENANT_ID: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  GYM_UNIT_ID: '9c858901-8a57-4791-81fe-4c455b099bc9',
});

const AGORA = new Date('2026-08-14T12:00:00.000Z');

describe('montarHeartbeat', () => {
  it('carrega tenant e unidade — regra de arquitetura no 2', () => {
    const hb = montarHeartbeat(config, [componenteProcesso(config)], AGORA);

    expect(hb.tenantId).toBe(config.TENANT_ID);
    expect(hb.gymUnitId).toBe(config.GYM_UNIT_ID);
    expect(hb.edgeAgentId).toBe('bancada-01');
  });

  it('componente INDISPONIVEL nao degrada o agente', () => {
    // O aceite da Slice 0.1 fala em "heartbeat dos componentes DISPONIVEIS".
    // Numa bancada sem leitor conectado o agente esta saudavel -- so nao tem
    // com quem falar. Degradar aqui faria o runbook parecer quebrado quando
    // esta certo.
    const semLeitor: Componente = {
      nome: 'leitor-facial',
      estado: 'indisponivel',
      detalhe: 'nao configurado',
    };

    expect(montarHeartbeat(config, [componenteProcesso(config), semLeitor], AGORA).estado).toBe(
      'ok',
    );
  });

  it('componente DEGRADADO degrada o agente', () => {
    const leitorMudo: Componente = {
      nome: 'leitor-facial',
      estado: 'degradado',
      detalhe: 'sem resposta',
    };

    expect(montarHeartbeat(config, [componenteProcesso(config), leitorMudo], AGORA).estado).toBe(
      'degradado',
    );
  });

  it('usa o instante recebido, nao o relogio', () => {
    // Funcao de calculo e pura: o "agora" entra por parametro
    // (CLAUDE.md -> Convencoes). Sem isso, testar degradacao por tempo
    // exigiria relogio falso.
    expect(montarHeartbeat(config, [], AGORA).emitidoEm).toBe('2026-08-14T12:00:00.000Z');
  });
});
